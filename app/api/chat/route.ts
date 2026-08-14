/**
 * POST /api/chat — SSE turn endpoint (SAD §4 "API contracts (normative)").
 *
 * Sprint 1 vertical slice ONLY: identity(orderId) → order lookup (read-only DuckDB +
 * DateShiftMapper) → streamed grounded status → done. There is deliberately NO LLM call in
 * this slice: the grounded sentence is composed deterministically from the tool result, so
 * the slice runs without an API key and evals stay reproducible.
 *
 * Zero money tools exist in this process: no refund, cancel, or payment code path.
 */

import type { ChatRequest, OrderSummary, StreamEvent } from "@shared/dto";
import { daysSince, resolveTemporalMeta, shiftIsoDate } from "@/server/data/dateShift";
import { getOrderItems, getRawOrder } from "@/server/data/duckdb";

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

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Deterministic, tool-grounded reply. Every fact here comes from the order read. */
function composeGroundedReply(order: OrderSummary, asOf: string): string[] {
  const age = daysSince(order.orderDate, asOf);
  const placed =
    age === 0 ? "today" : age === 1 ? "yesterday" : `${age} days ago`;
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

function chunk(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part.length > 0);
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
  const orderId = chatRequest.identity?.orderId;
  const trace = chatRequest.clientFlags?.trace === true;

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
      const send = (event: StreamEvent): void => controller.enqueue(frame(event));
      try {
        send({ type: "session", conversationId });

        if (orderId === undefined || !Number.isInteger(orderId)) {
          for (const part of chunk(
            "I can look that up — what is your order number?",
          )) {
            send({ type: "token", text: part });
          }
          send({ type: "done", status: "needs_input" });
          return;
        }

        if (trace) {
          send({ type: "agent_hop", agentId: "order-specialist", hop: 1 });
          send({ type: "tool_call", agentId: "order-specialist", tool: "get_order" });
        }

        const raw = await getRawOrder(orderId);
        if (raw === null) {
          for (const part of chunk(
            `I couldn't find order ${orderId}. Please double-check the number, or I can hand you to a human.`,
          )) {
            send({ type: "token", text: part });
          }
          send({ type: "done", status: "needs_input" });
          return;
        }

        const items = await getOrderItems(orderId);
        // Raw dates never reach the client: shift inside the adapter boundary.
        const order: OrderSummary = {
          ...raw,
          orderDate: shiftIsoDate(raw.orderDate, temporal.shiftDays),
          items,
        };

        for (const line of composeGroundedReply(order, temporal.asOf)) {
          for (const part of chunk(line)) send({ type: "token", text: part });
          send({ type: "token", text: "\n" });
        }

        send({
          type: "citation",
          ids: [`duckdb:orders:${order.orderId}`, `duckdb:order_items:${order.orderId}`],
        });
        send({ type: "done", status: "resolved" });
      } catch (err) {
        console.error("chat turn failed", err);
        send({
          type: "error",
          code: "turn_failed",
          message: "Something went wrong on our side. Please try again.",
          retryable: true,
        });
        send({ type: "done", status: "escalated" });
      } finally {
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
    },
  });
}
