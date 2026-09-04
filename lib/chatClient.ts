/**
 * Chat client: opens the turn stream, parses events (in turnService), and drives the FSM.
 * The client owns no turn semantics of its own — it forwards every StreamEvent into
 * `transition` and lets the server-sent `done` decide the terminal status.
 */

"use client";

import type { ChatRequest, StreamEvent } from "@shared/dto";
import type { TurnAction } from "./fsm";
import { mockStartTurn } from "./services/mockStream";
import { startTurn, type TurnHeaders } from "./services/turnService";

export type ValidationResult =
  | { ok: true; request: ChatRequest }
  | { ok: false; reason: string };

const ORDER_ID_PATTERN = /^\d+$/;

/** Client-side identity/message validation (spec: Inputs). Mirrors the server 400 rules. */
export function buildChatRequest(input: {
  message: string;
  orderId: string;
  userId: string;
  conversationId: string | null;
  trace: boolean;
}): ValidationResult {
  const message = input.message.trim();
  if (message.length === 0) return { ok: false, reason: "Type a message first." };
  if (message.length > 2000) return { ok: false, reason: "Message is too long (2000 characters max)." };

  const orderId = input.orderId.trim();
  const userId = input.userId.trim();

  if (orderId.length > 0 && !ORDER_ID_PATTERN.test(orderId)) {
    return { ok: false, reason: "Order number must be digits only." };
  }
  if (userId.length > 0 && !ORDER_ID_PATTERN.test(userId)) {
    return { ok: false, reason: "Customer id must be digits only." };
  }

  /*
   * DEF-12. This used to require an ORDER NUMBER specifically, and rejected the turn in the
   * browser — so a membership or order-history question with only a customer id never reached
   * the server at all. `ChatRequest.identity` has both fields optional and the server answers
   * those turns correctly; this function's own contract is to mirror the server's 400 rules,
   * and requiring more than the server does is not mirroring it.
   *
   * Six of the twenty-three demo scenarios were unreachable through the UI because of it,
   * including `list_orders_for_user` — the one tool whose entire purpose is answering without
   * an order id.
   *
   * What is still required is SOME identity. A bare question with neither id is a turn the
   * server can only answer with a clarifying question, and asking here costs no round trip.
   */
  if (orderId.length === 0 && userId.length === 0) {
    return { ok: false, reason: "Add an order number or a customer id so we can look it up." };
  }

  const identity: { orderId?: number; userId?: number } = {};
  if (orderId.length > 0) identity.orderId = Number(orderId);
  if (userId.length > 0) identity.userId = Number(userId);

  return {
    ok: true,
    request: {
      ...(input.conversationId !== null ? { conversationId: input.conversationId } : {}),
      message,
      identity,
      clientFlags: { trace: input.trace },
    },
  };
}

function useMockStream(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_STREAM === "1";
}

/**
 * Run one turn to completion. Dispatches `submit`, then one `event` action per StreamEvent.
 * Never dispatches a terminal state itself: a transport failure is surfaced as an `error`
 * event so the FSM sees the same shape it would from the server.
 */
export async function runTurn(
  request: ChatRequest,
  dispatch: (action: TurnAction) => void,
  signal?: AbortSignal,
  onHeaders?: (headers: TurnHeaders) => void,
): Promise<void> {
  dispatch({ kind: "submit" });

  if (useMockStream()) {
    // The mock's fidelity extends to the RESPONSE HEADERS, not just the frames. Without this
    // the TracePanel's metadata row renders as five em-dashes in mock mode, so the one surface
    // that displays turn metadata cannot be developed offline — the same drift that left the
    // mock without `csat_prompt`. Values are obviously synthetic and labelled as such.
    onHeaders?.({
      conversationId: request.conversationId ?? "mock-conversation",
      engine: "mock",
      asOf: new Date().toISOString().slice(0, 10),
      shiftDays: "0",
      overlayHit: "false",
    });
  }

  const source: AsyncIterable<StreamEvent> = useMockStream()
    ? mockStartTurn(request)
    : startTurn(request, signal, onHeaders);

  try {
    for await (const event of source) {
      dispatch({ kind: "event", event });
    }
  } catch (err) {
    const aborted = signal?.aborted === true;
    dispatch({
      kind: "event",
      event: {
        type: "error",
        code: aborted ? "aborted" : "stream_failed",
        message: aborted
          ? "The turn was cancelled."
          : "The connection dropped before we finished. Please try again.",
        retryable: !aborted,
      },
    });
    if (!aborted) {
      // Surface unexpected failures in the dev console; no PII in the event payload.
      console.error("chatClient.runTurn failed", err);
    }
  }
}
