/**
 * Service surface for one chat turn.
 *
 * These replace the generic `startRun` / `getRunStatus` pair because ADR-04 makes the turn a
 * server-push SSE stream, not a poll-based run: `startTurn` yields `StreamEvent`s as they
 * arrive, and there is no status to poll — `getTurnTrace` is an operator read-after-the-fact.
 */

import type { ChatRequest, StreamEvent } from "@shared/dto";
import { parseStreamEvent } from "@shared/streamEvent";

export const CHAT_ENDPOINT = "/api/chat";

/**
 * Operator trace read (F-TRACE-01) — the shape `GET /api/conversations/:id/trace` ACTUALLY
 * returns.
 *
 * The previous declaration was written before the route existed and never reconciled with it:
 * it promised `temporal` and `tools`, neither of which the endpoint sends, and typed `hops` as
 * `{agentId, hop}` when the route returns a merged event stream. `getTurnTrace` then cast the
 * JSON to it, so every one of those mismatches was invisible to the compiler and would have
 * surfaced as `undefined` at the first caller. This is the same defect class as OQ-5, one
 * layer up: a cast standing in for a contract.
 */
export type TurnTrace = {
  conversationId: string;
  /** Hop path, tool calls, denials and budget exhaustion, in arrival order. */
  hops: Array<{
    ts: string | null;
    event: string | null;
    agentId: string | null;
    tool: string | null;
    hop: number | null;
    reason: string | null;
  }>;
  /** One entry per turn on this conversation, with the model's own usage figures. */
  turns: Array<{
    ts: string | null;
    hops: number | null;
    path: string[] | null;
    numTurns: number | null;
    costUsd: number | null;
  }>;
  transcript: Array<{ role: "user" | "assistant"; content: string; status: string | null; ts: string }>;
  identity: { userId?: number; orderId?: number };
  csat: { score: number; comment: string | null; at: string } | null;
  ticketStubs: Array<{
    ticket_stub_id: string;
    reason_code: string;
    urgency: string;
    created_at: string;
    entities: { order_id?: number; user_id?: number; device?: string; app_version?: string };
    suggested_category: string;
  }>;
  traceRecordCount: number;
};

/**
 * Turn metadata that rides on the RESPONSE HEADERS rather than in the stream (SAD §4).
 *
 * It is on the headers because an operator must be able to reconstruct a turn without
 * parsing the body — and because `asOf` / `shiftDays` describe the turn as a whole, not any
 * one frame in it. The TracePanel reads it from here; the customer surface never shows it.
 */
export type TurnHeaders = {
  conversationId: string | null;
  engine: string | null;
  asOf: string | null;
  shiftDays: string | null;
  overlayHit: string | null;
};

/**
 * POST /api/chat and yield parsed SSE events in order.
 * Aborting the signal cancels the turn server-side via client disconnect (SAD §2 Aborted).
 *
 * `onHeaders` fires once, before the first event, with the `X-Novamart-*` metadata. It is a
 * callback rather than a synthetic first event because those headers are NOT part of the
 * `StreamEvent` union, and widening a frozen wire contract (SAD contract-freeze gate) to
 * carry client convenience is exactly the drift that gate exists to prevent.
 */
export async function* startTurn(
  req: ChatRequest,
  signal?: AbortSignal,
  onHeaders?: (headers: TurnHeaders) => void,
): AsyncIterable<StreamEvent> {
  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(req),
    ...(signal ? { signal } : {}),
  });

  onHeaders?.({
    conversationId: response.headers.get("x-novamart-conversation-id"),
    engine: response.headers.get("x-novamart-engine"),
    asOf: response.headers.get("x-novamart-as-of"),
    shiftDays: response.headers.get("x-novamart-shift-days"),
    overlayHit: response.headers.get("x-novamart-overlay-hit"),
  });

  if (!response.ok || response.body === null) {
    yield {
      type: "error",
      code: `http_${response.status}`,
      message: "The support assistant is unavailable right now.",
      retryable: response.status >= 500,
    };
    yield { type: "done", status: "escalated" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseFrame(frame);
      if (event !== null) yield event;
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/**
 * Parse one SSE frame; ignore comments/heartbeats and anything that is not a valid
 * `StreamEvent`.
 *
 * VALIDATED, NOT CAST (integration.md OQ-5). This used to accept any object carrying a `type`
 * field and assert it into the union, which held only while the sole producer was our own
 * route handler. `parseStreamEvent` checks the required fields of the actual variant, so a
 * malformed frame is dropped here — where a `frame_rejected` line names it — instead of
 * reaching the FSM as a variant with undefined fields and surfacing as a blank message.
 */
function parseFrame(frame: string): StreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }

  const event = parseStreamEvent(parsed);
  if (event === null && parsed !== null) {
    // Not thrown: one bad frame must not kill a turn that is otherwise fine, and the envelope
    // guarantees a `done` will still arrive. Logged, because a silently dropped frame is the
    // hardest kind of wire bug to find later.
    console.warn("frame_rejected", parsed);
  }
  return event;
}

/**
 * The operator trace read — `GET /api/conversations/:id/trace`, built 2026-08-28.
 *
 * NOT used by the chat page, and that is the point. The page's TracePanel renders the frames
 * THIS client was sent; this reads the server's own record of a conversation, including turns
 * the browser never saw, and it needs the shared operator secret. A browser is the wrong place
 * to hold that secret, so this exists for an operator tool or a script — passing the key from
 * client-side code would put it in the bundle and in every request the page makes.
 */
export async function getTurnTrace(
  conversationId: string,
  operatorKey: string,
): Promise<TurnTrace> {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/trace`,
    { headers: { "X-Operator-Key": operatorKey } },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Trace read failed (HTTP ${response.status}).`);
  }
  const body: unknown = await response.json();
  // A shallow shape check, for the same reason `parseFrame` validates: this is a cast at a
  // process boundary, and the compiler cannot help. Full validation of a nested operator
  // payload would be more machinery than the one caller justifies.
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as TurnTrace).hops) ||
    !Array.isArray((body as TurnTrace).turns)
  ) {
    throw new Error("Trace read returned an unexpected shape.");
  }
  return body as TurnTrace;
}
