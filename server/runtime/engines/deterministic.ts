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
 * payment code path here or anywhere it imports.
 */

import type { OrderSummary } from "@shared/dto";
import { daysSince, shiftIsoDate } from "@/server/data/dateShift";
import { getOrderItems, getRawOrder } from "@/server/data/duckdb";
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

    emitLines(emit, composeGroundedReply(order, temporal.asOf));

    emit({
      type: "citation",
      ids: [`duckdb:orders:${order.orderId}`, `duckdb:order_items:${order.orderId}`],
    });
    emit({ type: "done", status: "resolved" });
  },
};
