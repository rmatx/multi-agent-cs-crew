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
import { requestPassedGate } from "@/server/runtime/demoGate";
import { checkRateLimit, clientKey } from "@/server/runtime/rateLimit";
import { extractAppContext } from "@/server/runtime/escalationContext";
import {
  appendMessage,
  ensureSession,
  loadSession,
  mergeIdentity,
  rememberAppContext,
  saveIdentity,
} from "@/server/runtime/session";
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
  // Before parsing anything: a turn on the sdk engine spends the operator's API key, and this
  // endpoint has no authentication (integration.md, Assumption 2). Cheapest possible check
  // first, so a loop costs a map lookup rather than a JSON parse and a DuckDB read.
  const limit = checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    return Response.json(
      {
        code: "rate_limited",
        message: "Too many messages. Please wait a moment and try again.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

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
  /*
   * A request that came through the reviewer gate runs the crew; everyone else runs whatever
   * `CHAT_ENGINE` says, which in the live deployment is the keyless deterministic engine.
   *
   * This is what keeps the public URL — the one printed in a submission document already handed
   * in — answering for a grader with no password, while making it impossible for an anonymous
   * caller to spend the operator's API key. The rate limit above still applies to both: it
   * guards the process, not just the wallet.
   */
  const engineId = (await requestPassedGate(request)) ? "sdk" : resolveEngineId();
  const budgets = resolveBudgets();

  // Session first (ADR-10): the stored identity feeds the temporal resolve below, so a
  // customer who gave a user id last turn still matches an overlay persona on this one.
  let session;
  let identity;
  let appContext;
  try {
    ensureSession(conversationId);
    session = loadSession(conversationId);
    identity = mergeIdentity(session.identity, chatRequest.identity ?? {});
    saveIdentity(conversationId, identity);
    // AC-TRIAGE-03 / AC-TICKET-01: a customer states their device once and escalates two
    // turns later, so this is remembered on the session rather than only read per turn.
    appContext = rememberAppContext(
      conversationId,
      session.appContext,
      extractAppContext(chatRequest.message),
    );
    appendMessage(conversationId, "user", chatRequest.message);
  } catch (err) {
    console.error("session store failed", err);
    return Response.json(
      { code: "session_unavailable", message: "Chat is unavailable right now." },
      { status: 500 },
    );
  }

  // Temporal context is resolved before any date leaves the server (F-TIME-01).
  let temporal;
  try {
    temporal = await resolveTemporalMeta(identity);
  } catch (err) {
    console.error("temporal resolve failed", err);
    return Response.json(
      { code: "duckdb_unavailable", message: "Order data is unavailable right now." },
      { status: 500 },
    );
  }

  // Set by `cancel()` when the consumer goes away. The controller is closed underneath us at
  // that point, so every later enqueue would throw — see `send`.
  let consumerGone = false;
  // Assigned once the turn's AbortController exists, so `cancel()` can stop in-flight work.
  let abortTurn: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // One turn, one abort signal: client disconnect OR the SAD turn timeout (SAD §2
      // Cancellation). In-flight work observes it; no partial ticket stub is written.
      const abort = new AbortController();
      const onDisconnect = (): void => abort.abort(new Error("client_disconnect"));
      request.signal.addEventListener("abort", onDisconnect, { once: true });
      abortTurn = onDisconnect;
      const timer = setTimeout(
        () => abort.abort(new Error("turn_timeout")),
        budgets.turnTimeoutMs,
      );

      let terminated = false;
      let streamDead = false;
      /** Assistant text as the customer received it, for the transcript. */
      let replyText = "";
      let terminalStatus: string | null = null;
      let csatSent = false;

      // `send` MUST NOT throw. It is called from inside engine code, so a dead stream that
      // threw here would surface as an engine defect: the throw unwinds into the engine's own
      // catch, gets traced as `turn_error`, and the engine then emits an error frame that
      // throws again. That is the ERR_INVALID_STATE ("Controller is already closed") seen in
      // the 2026-08-23 traces — always AFTER a successful `turn_result`, i.e. a turn that in
      // fact worked, reported as a failure. A disconnected client is a normal end to a turn,
      // not a fault, so drop the frame and let the turn wind down quietly.
      const enqueue = (event: StreamEvent): void => {
        if (streamDead || consumerGone) return;
        try {
          controller.enqueue(frame(event));
        } catch {
          streamDead = true;
        }
      };

      const send = (event: StreamEvent): void => {
        if (terminated) return; // nothing may follow `done`
        if (event.type === "token") replyText += event.text;
        if (event.type === "done") {
          terminated = true;
          terminalStatus = event.status;
          // F-CSAT-01. The envelope guarantees `done` is last, so the prompt goes BEFORE it —
          // and it belongs here rather than in either engine, because "ask after a turn that
          // actually finished" is a property of the turn, not of how the turn was computed.
          // A `needs_input` turn is not finished: asking a customer to rate an unanswered
          // question is the kind of thing that makes people distrust a support bot.
          if (!csatSent && event.status !== "needs_input") {
            csatSent = true;
            enqueue({ type: "csat_prompt" });
          }
        }
        enqueue(event);
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
          identity,
          appContext,
          history: session.transcript.map(({ role, content }) => ({ role, content })),
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
        // Persist what the customer actually saw, even on an aborted or failed turn — a
        // half-turn is still part of the conversation, and dropping it would make the next
        // turn's history lie about what was said.
        try {
          appendMessage(conversationId, "assistant", replyText, terminalStatus);
        } catch (err) {
          console.error("transcript write failed", err);
        }
        // Same reasoning as `send`: closing an already-closed controller throws, and this is
        // a `finally`, so the throw would replace whatever really happened in the turn.
        if (!streamDead && !consumerGone) {
          try {
            controller.close();
          } catch {
            streamDead = true;
          }
        }
      }
    },

    // The consumer went away (browser navigation, curl exiting, a proxy dropping the
    // connection). The controller is closed from under us here, so record it and abort the
    // in-flight turn rather than letting it run on to completion for nobody.
    cancel(): void {
      consumerGone = true;
      abortTurn?.();
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
