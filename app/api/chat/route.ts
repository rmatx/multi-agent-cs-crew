/**
 * POST /api/chat — SSE turn endpoint (SAD §4 "API contracts (normative)").
 *
 * This handler does four things and nothing else: parse/validate the `ChatRequest`, resolve
 * the temporal context, pick a `TurnEngine`, and pump its events onto the SSE wire. All turn
 * behaviour lives behind `server/runtime/engine.ts`.
 *
 * Engine selection — `CHAT_ENGINE=deterministic|sdk`, DEFAULT `deterministic`:
 *   deterministic  Sprint 1 slice. identity(orderId) → read-only DuckDB + DateShiftMapper →
 *                  grounded sentence composed in code. No LLM, no key, no network.
 *   sdk            claude-agent-sdk crew (opt-in, needs ANTHROPIC_API_KEY + MODEL_ID).
 *
 * Zero money tools exist in this process: no refund, cancel, or payment code path.
 */

import type { ChatRequest, StreamEvent } from "@shared/dto";
import { resolveTemporalMeta } from "@/server/data/dateShift";
import { resolveBudgets, resolveEngineId } from "@/server/runtime/config";
import type { TurnInput } from "@/server/runtime/engine";
import { loadEngine } from "@/server/runtime/engines/select";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function frame(event: StreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function isChatRequest(body: unknown): body is ChatRequest {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return typeof candidate["message"] === "string";
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "invalid_json", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  if (!isChatRequest(body)) {
    return Response.json(
      { code: "invalid_request", message: "`message` is required." },
      { status: 400 },
    );
  }

  const chatRequest = body;
  const conversationId = chatRequest.conversationId ?? crypto.randomUUID();
  const trace = chatRequest.clientFlags?.trace === true;
  const engineId = resolveEngineId();
  const budgets = resolveBudgets();

  // Temporal context is resolved before any date leaves the server (F-TIME-01).
  let temporal;
  try {
    temporal = await resolveTemporalMeta();
  } catch (err) {
    console.error("temporal resolve failed", err);
    return Response.json(
      { code: "duckdb_unavailable", message: "Order data is unavailable right now." },
      { status: 500 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // One turn, one abort signal: client disconnect OR the SAD turn timeout (SAD §2
      // Cancellation). In-flight work observes it; no partial ticket stub is written.
      const abort = new AbortController();
      const onDisconnect = (): void => abort.abort(new Error("client_disconnect"));
      request.signal.addEventListener("abort", onDisconnect, { once: true });
      const timer = setTimeout(
        () => abort.abort(new Error("turn_timeout")),
        budgets.turnTimeoutMs,
      );

      let terminated = false;
      const send = (event: StreamEvent): void => {
        if (terminated) return; // nothing may follow `done`
        if (event.type === "done") terminated = true;
        controller.enqueue(frame(event));
      };

      try {
        send({ type: "session", conversationId });

        const loaded = await loadEngine(engineId);
        if (!loaded.ok) {
          send({ type: "error", code: loaded.code, message: loaded.message, retryable: false });
          send({ type: "done", status: "escalated" });
          return;
        }

        const input: TurnInput = {
          conversationId,
          message: chatRequest.message,
          identity: chatRequest.identity ?? {},
          trace,
          temporal,
          signal: abort.signal,
        };

        await loaded.engine.runTurn(input, send);

        // An engine that returned without a terminal frame is a defect, not a customer
        // problem — close the turn safely rather than leaving the stream hanging.
        if (!terminated) {
          send({ type: "done", status: "needs_input" });
        }
      } catch (err) {
        console.error("chat turn failed", err);
        const aborted = abort.signal.aborted;
        send({
          type: "error",
          code: aborted ? "turn_aborted" : "turn_failed",
          message: aborted
            ? "That took too long, so I stopped. Please try again, or ask for a human."
            : "Something went wrong on our side. Please try again.",
          retryable: true,
        });
        send({ type: "done", status: "escalated" });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onDisconnect);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Trace metadata required by the Sprint 1 exit criteria. No UI panel renders it yet,
      // but it is on the response so the operator trace can show { asOf, shiftDays, overlayHit }.
      "X-Novamart-As-Of": temporal.asOf,
      "X-Novamart-Shift-Days": String(temporal.shiftDays),
      "X-Novamart-Overlay-Hit": String(temporal.overlayHit),
      "X-Novamart-Conversation-Id": conversationId,
      "X-Novamart-Engine": engineId,
    },
  });
}
