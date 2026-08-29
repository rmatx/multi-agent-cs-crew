/**
 * Service surface for one chat turn.
 *
 * These replace the generic `startRun` / `getRunStatus` pair because ADR-04 makes the turn a
 * server-push SSE stream, not a poll-based run: `startTurn` yields `StreamEvent`s as they
 * arrive, and there is no status to poll — `getTurnTrace` is an operator read-after-the-fact.
 */

import type { ChatRequest, StreamEvent, TemporalMeta } from "@shared/dto";

export const CHAT_ENDPOINT = "/api/chat";

/** Operator trace read (F-TRACE-01). Backend route lands with the trace panel — Sprint 2. */
export type TurnTrace = {
  conversationId: string;
  temporal: TemporalMeta;
  hops: Array<{ agentId: string; hop: number }>;
  tools: Array<{ agentId: string; tool: string; ok: boolean }>;
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

/** Parse one SSE frame; ignore comments/heartbeats and anything not shaped like a StreamEvent. */
function parseFrame(frame: string): StreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
      return parsed as StreamEvent;
    }
    return null;
  } catch {
    return null;
  }
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
  return (await response.json()) as TurnTrace;
}
