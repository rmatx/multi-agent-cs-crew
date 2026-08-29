/**
 * Deterministic turn engine — the Sprint 1 vertical slice, PORTED VERBATIM from the original
 * `app/api/chat/route.ts` (commit 65104f8). Behaviour is byte-identical on the wire; only its
 * address changed.
 *
 * identity(orderId) → read-only DuckDB + DateShiftMapper → grounded sentence composed IN CODE.
 * There is deliberately NO LLM call here: this engine runs with no ANTHROPIC_API_KEY, no
 * network, and no subprocess, which is what keeps the demo and the F-EVAL-01 scripts
 * reproducible. It is the DEFAULT engine and must stay that way.
 *
 * Zero money tools: this module reads orders and formats text. There is no refund, cancel or
 * payment code path here or anywhere it imports. It ROUTES money requests to a human; it never
 * services one.
 *
 * ADR-16 (SAD §6, amended 2026-08-27): escalation is a `TurnEngine` obligation, not an
 * sdk-engine feature. This engine is the DEFAULT, and before that ruling a customer asking for
 * a refund here got an honest "I can't do that" and no human — the reply was true and the
 * handoff never happened (INT-01). The engines may differ in HOW they decide; they may not
 * differ in WHETHER they route.
 */

import type { OrderSummary } from "@shared/dto";
import { daysSince, shiftIsoDate } from "@/server/data/dateShift";
import { getOrderItems, getRawOrder } from "@/server/data/duckdb";
import { createTicketStub, formatHandoffSummary } from "../escalation";
import { categoryForIntent } from "../escalationContext";
import { isMoneyRequest } from "../moneyIntent";
import { chunk, emitLines, type TurnEmit, type TurnEngine, type TurnInput } from "../engine";

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Deterministic, tool-grounded reply. Every fact here comes from the order read. */
function composeGroundedReply(order: OrderSummary, asOf: string): string[] {
  const age = daysSince(order.orderDate, asOf);
  const placed = age === 0 ? "today" : age === 1 ? "yesterday" : `${age} days ago`;
  const lines = [
    `Order ${order.orderId} is ${order.status}.`,
    `Placed ${order.orderDate} (${placed}). Order total ${money(order.totalAmount)}.`,
  ];
  if (order.items.length > 0) {
    lines.push("Items:");
    for (const item of order.items) {
      lines.push(`- ${item.productName} x${item.quantity} — ${money(item.lineTotal)}`);
    }
  }
  lines.push("I can't process refunds, cancellations, or payments here.");
  return lines;
}

/**
 * Route a money request to a human, with the package built IN CODE.
 *
 * The sdk engine has a specialist compose this package; here every field is derived from the
 * order read and the matched intent, which is why the reason code is always
 * `payment_or_refund` — it is the only one this engine can establish without inferring.
 */
function escalateMoneyRequest(
  input: TurnInput,
  order: OrderSummary,
  emit: TurnEmit,
): void {
  const citations = [
    `duckdb:orders:${order.orderId}`,
    `duckdb:order_items:${order.orderId}`,
  ];

  const result = createTicketStub(
    {
      conversationId: input.conversationId,
      intent: "payment_question",
      entities: {
        // AC-TICKET-01: same runtime derivation as the sdk engine. A customer reporting a
        // crash on the keyless path deserves the same ticket as one on the crew path.
        ...input.appContext,
        order_id: order.orderId,
        user_id: order.userId,
      },
      urgency: "medium",
      transcript_summary:
        `Customer asked about a refund, cancellation, or payment on order ${order.orderId} ` +
        `(status ${order.status}, total ${money(order.totalAmount)}). No money action is ` +
        `possible in this system, so the request was routed to a human without any attempt ` +
        `to service it.`,
      tools_tried: [
        { tool: "get_order", ok: true, summary: `Order ${order.orderId} is ${order.status}.` },
        {
          tool: "get_order_items",
          ok: true,
          summary: `${order.items.length} line item(s).`,
        },
      ],
      citations,
      reason_code: "payment_or_refund",
      // AC-ESC-05 through the normative map, not a hand-picked string. `payment_question`
      // maps to `payment_issue`; "billing" was close and not what the PRD says.
      suggested_category: categoryForIntent("payment_question"),
    },
    { asOf: input.temporal.asOf },
  );

  if (!result.ok) {
    // The package is code-built from a row that was just read, so this is unreachable in
    // practice. If it ever fires, say so plainly rather than pretending a human was engaged.
    emitLines(emit, [
      "I can't process refunds, cancellations, or payments, and I wasn't able to open a ticket",
      "for you just now. Please try again in a moment.",
    ]);
    emit({ type: "done", status: "needs_input" });
    return;
  }

  emitLines(emit, [formatHandoffSummary(result.stub)]);
  emit({ type: "citation", ids: citations });
  emit({
    type: "escalation",
    ticketStubId: result.ticket_stub_id,
    reasonCode: result.stub.reason_code,
  });
  emit({ type: "done", status: "escalated" });
}

export const deterministicEngine: TurnEngine = {
  id: "deterministic",

  async runTurn(input: TurnInput, emit: TurnEmit): Promise<void> {
    const { identity, trace, temporal } = input;
    const orderId = identity.orderId;

    if (orderId === undefined || !Number.isInteger(orderId)) {
      for (const part of chunk("I can look that up — what is your order number?")) {
        emit({ type: "token", text: part });
      }
      emit({ type: "done", status: "needs_input" });
      return;
    }

    if (trace) {
      emit({ type: "agent_hop", agentId: "order-specialist", hop: 1 });
      emit({ type: "tool_call", agentId: "order-specialist", tool: "get_order" });
    }

    const raw = await getRawOrder(orderId);
    if (raw === null) {
      for (const part of chunk(
        `I couldn't find order ${orderId}. Please double-check the number, or I can hand you to a human.`,
      )) {
        emit({ type: "token", text: part });
      }
      emit({ type: "done", status: "needs_input" });
      return;
    }

    const items = await getOrderItems(orderId);
    // Raw dates never reach the client: shift inside the adapter boundary.
    const order: OrderSummary = {
      ...raw,
      orderDate: shiftIsoDate(raw.orderDate, temporal.shiftDays),
      items,
    };

    // ADR-16: money requests route to a human on EVERY engine. Checked after the order read so
    // the package carries real facts, and before the grounded reply so the customer is never
    // told "I can't do that" without a handoff behind it.
    if (isMoneyRequest(input.message)) {
      escalateMoneyRequest(input, order, emit);
      return;
    }

    emitLines(emit, composeGroundedReply(order, temporal.asOf));

    emit({
      type: "citation",
      ids: [`duckdb:orders:${order.orderId}`, `duckdb:order_items:${order.orderId}`],
    });
    emit({ type: "done", status: "resolved" });
  },
};
