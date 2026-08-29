/**
 * Dev-only mock stream. Same signature as `startTurn`, same frozen DTO types — the SAD
 * contract-freeze gate requires the mock to IMPORT `StreamEvent`, never restate it.
 * Enable with NEXT_PUBLIC_USE_MOCK_STREAM=1.
 *
 * A MOCK THAT HAS DRIFTED IS WORSE THAN NO MOCK. This one was written for the Sprint 1 wire
 * and never revisited: it emitted no `citation`, no `csat_prompt` and no `escalation`, and it
 * sent `agent_hop` / `tool_call` unconditionally. So a frontend developed against it could not
 * see the Sources line, could not render the CSAT card at all, could not build the handoff
 * copy — and would have shown trace frames to a customer who never asked for them, because the
 * real server gates those on `clientFlags.trace` and this did not.
 *
 * The gate's rule is now explicit here: **this file must mirror what the route sends,
 * including what it withholds.** Anything the mock cannot produce is a surface nobody can
 * develop offline.
 */

import type { ChatRequest, StreamEvent } from "@shared/dto";

const TOKEN_DELAY_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Money vocabulary, so the mock can exercise the handoff path the real crew escalates. */
const MONEY = /\b(refund|money back|chargeback|cancel|payment|charge me|billing)\b/i;

async function* words(sentence: string): AsyncIterable<StreamEvent> {
  for (const word of sentence.split(" ")) {
    await sleep(TOKEN_DELAY_MS);
    yield { type: "token", text: `${word} ` };
  }
}

export async function* mockStartTurn(req: ChatRequest): AsyncIterable<StreamEvent> {
  // Trace frames are OPERATOR-ONLY on the wire (SAD §2). The mock withholds them exactly as
  // the route does, so the TracePanel's empty state is developable offline.
  const trace = req.clientFlags?.trace === true;

  yield { type: "session", conversationId: req.conversationId ?? "mock-conversation" };

  const orderId = req.identity?.orderId;
  if (orderId === undefined) {
    yield* words("I can look that up — what is your order number?");
    // No `csat_prompt`: the route withholds it on `needs_input`, and so does this.
    yield { type: "done", status: "needs_input" };
    return;
  }

  if (MONEY.test(req.message)) {
    if (trace) {
      yield { type: "agent_hop", agentId: "escalation-handoff", hop: 1 };
      yield { type: "tool_call", agentId: "escalation-handoff", tool: "mcp__novamart__create_ticket_stub" };
      yield { type: "tool_call", agentId: "escalation-handoff", tool: "mcp__novamart__format_handoff_summary" };
    }
    yield* words(
      "I'm not able to process refunds myself, but I've opened a ticket with our support team.",
    );
    yield { type: "escalation", ticketStubId: "STUB-M0CK1234", reasonCode: "payment_or_refund" };
    yield { type: "csat_prompt" };
    yield { type: "done", status: "escalated" };
    return;
  }

  if (trace) {
    yield { type: "agent_hop", agentId: "order-specialist", hop: 1 };
    yield { type: "tool_call", agentId: "order-specialist", tool: "mcp__novamart__get_order" };
    yield { type: "tool_call", agentId: "order-specialist", tool: "mcp__novamart__get_order_items" };
  }

  yield* words(
    `Order ${orderId} is completed. It was placed on 2026-07-30 for $64.36 (1 item). ` +
      "There is no tracking detail available in this system.",
  );
  yield { type: "citation", ids: [`duckdb:orders:${orderId}`, `duckdb:order_items:${orderId}`] };
  yield { type: "csat_prompt" };
  yield { type: "done", status: "resolved" };
}
