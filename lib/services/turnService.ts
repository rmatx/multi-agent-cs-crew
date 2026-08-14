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
 * POST /api/chat and yield parsed SSE events in order.
 * Aborting the signal cancels the turn server-side via client disconnect (SAD §2 Aborted).
 */
export async function* startTurn(
  req: ChatRequest,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(req),
    ...(signal ? { signal } : {}),
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
 * STUB — the operator trace read. `GET /api/conversations/:id/trace` is Sprint 2 (SAD:
 * "TracePanel UI" and the trace route are out of the Sprint 1 slice). The temporal fields
 * it must expose — { asOf, shiftDays, overlayHit } — are already emitted by /api/chat.
 */
export async function getTurnTrace(conversationId: string): Promise<TurnTrace> {
  throw new Error(
    `getTurnTrace(${conversationId}) is not implemented in Sprint 1: the operator trace route is deferred.`,
  );
}
