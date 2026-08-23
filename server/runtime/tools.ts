/**
 * In-process MCP tool server for the sdk engine (ADR-07: tools are in-process, no external
 * MCP server required; adapter Tools: "Prefer in-process MCP servers for custom internal
 * tools").
 *
 * TEMPORAL SAFETY (SAD §4): every date returned from here has already been through
 * `DateShiftMapper`. The turn's `shiftDays` / `alignMaxDateToToday` / `overlayHit` knobs are
 * NOT in `ToolContext` at all — an agent that could read `shiftDays` could subtract it back
 * off and reason about the real 2024 dataset. Tools receive `asOf` only.
 *
 * ZERO MONEY TOOLS: the four factories below are the complete set of callable side doors in
 * this process. `assertNoMoneyTools` + `assertRegisteredSetMatches` run before the server is
 * built, so a money tool added here is a boot failure, not a runtime surprise.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { shiftIsoDate } from "@/server/data/dateShift";
import { getOrderItems, getRawOrder } from "@/server/data/duckdb";
import { createTicketStub, formatHandoffSummary, getTicketStub } from "./escalation";
import type { AgentTemporalView } from "./engine";
import {
  MCP_SERVER_NAME,
  REGISTERED_TOOL_NAMES,
  assertNoMoneyTools,
  assertRegisteredSetMatches,
} from "./toolRegistry";
import type { Tracer } from "./trace";

export type ToolContext = {
  readonly conversationId: string;
  /** Agent-visible time only. Deliberately narrow — see the module header. */
  readonly temporal: AgentTemporalView;
  /** Applied inside this module before any row is returned; never surfaced to the model. */
  readonly shiftDays: number;
  readonly tracer: Tracer;
  readonly readRetries: number;
  readonly signal: AbortSignal;
};

function ok(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function fail(code: string, message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code, message }) }],
    isError: true,
  };
}

/**
 * One retry for an idempotent repository read (SAD §2 Retries). Validation errors are not
 * retried — only transport/transient failures reach here, and a second identical read is
 * safe because every read port is side-effect free.
 */
async function withReadRetry<T>(
  ctx: ToolContext,
  toolName: string,
  run: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= ctx.readRetries; attempt += 1) {
    if (ctx.signal.aborted) throw new Error("aborted");
    try {
      return await run();
    } catch (err) {
      lastError = err;
      ctx.tracer.log({ event: "tool_retry", tool: toolName, attempt });
    }
  }
  throw lastError;
}

export function createNovamartToolServer(ctx: ToolContext) {
  // L2 — startup assertion. Runs before a single AgentDefinition exists.
  assertNoMoneyTools(REGISTERED_TOOL_NAMES);
  assertRegisteredSetMatches(REGISTERED_TOOL_NAMES);

  const getOrder = tool(
    "get_order",
    "Look up one NovaMart order by its numeric id. Read-only. Returns status, order date " +
      "(already expressed on the current calendar), and total. Returns not_found if the id " +
      "does not exist.",
    { order_id: z.number().int().positive() },
    async (args) => {
      const row = await withReadRetry(ctx, "get_order", () => getRawOrder(args.order_id));
      if (row === null) {
        return fail("not_found", `No order ${args.order_id}.`);
      }
      return ok({
        order_id: row.orderId,
        user_id: row.userId,
        status: row.status,
        // Shift applied HERE, at the adapter boundary. The model never sees the raw date.
        order_date: shiftIsoDate(row.orderDate, ctx.shiftDays),
        total_amount: row.totalAmount,
        as_of: ctx.temporal.asOf,
        citation: `duckdb:orders:${row.orderId}`,
      });
    },
  );

  const getOrderItemsTool = tool(
    "get_order_items",
    "List the line items on one NovaMart order. Read-only.",
    { order_id: z.number().int().positive() },
    async (args) => {
      const items = await withReadRetry(ctx, "get_order_items", () =>
        getOrderItems(args.order_id),
      );
      return ok({
        order_id: args.order_id,
        items: items.map((item) => ({
          product_name: item.productName,
          quantity: item.quantity,
          line_total: item.lineTotal,
        })),
        citation: `duckdb:order_items:${args.order_id}`,
      });
    },
  );

  const createTicketStubTool = tool(
    "create_ticket_stub",
    "Open a support ticket stub for a human agent. Requires a complete escalation package; " +
      "a partial package is REJECTED rather than written. This does not move money, refund, " +
      "cancel, or charge anything — it only records that a human must take over.",
    {
      conversationId: z.string().min(1),
      intent: z.string().min(1),
      entities: z.object({
        order_id: z.number().int().optional(),
        user_id: z.number().int().optional(),
        device: z.string().optional(),
        app_version: z.string().optional(),
      }),
      urgency: z.enum(["low", "medium", "high", "critical"]),
      transcript_summary: z.string().min(1),
      tools_tried: z.array(
        z.object({ tool: z.string(), ok: z.boolean(), summary: z.string() }),
      ),
      citations: z.array(z.string()),
      reason_code: z.enum([
        "customer_requested_human",
        "ungrounded",
        "restricted_action",
        "low_confidence",
        "repeat_failure",
        "high_severity",
        "payment_or_refund",
      ]),
      suggested_category: z.string().min(1),
    },
    async (args) => {
      const result = createTicketStub(args, { asOf: ctx.temporal.asOf });
      if (!result.ok) {
        ctx.tracer.log({ event: "escalation_rejected", errors: result.errors });
        return fail("incomplete_package", result.errors.join("; "));
      }
      ctx.tracer.log({
        event: "ticket_stub_created",
        ticket_stub_id: result.ticket_stub_id,
        reason_code: result.stub.reason_code,
      });
      return ok({ ticket_stub_id: result.ticket_stub_id });
    },
  );

  const formatHandoffSummaryTool = tool(
    "format_handoff_summary",
    "Turn an existing ticket stub id into the customer-safe sentence to send. No side effects.",
    { ticket_stub_id: z.string().min(1) },
    async (args) => {
      const stub = getTicketStub(args.ticket_stub_id);
      if (stub === undefined) {
        return fail("not_found", `No ticket stub ${args.ticket_stub_id}.`);
      }
      return ok({ summary: formatHandoffSummary(stub) });
    },
  );

  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "1.0.0",
    instructions:
      "NovaMart read-only support tools. No tool here can move money, refund, cancel, or " +
      "charge. Dates returned are already on the current calendar.",
    tools: [getOrder, getOrderItemsTool, createTicketStubTool, formatHandoffSummaryTool],
  });
}
