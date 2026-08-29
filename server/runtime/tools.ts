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
 * ZERO MONEY TOOLS: the nine factories below are the complete set of callable side doors in
 * this process. `assertNoMoneyTools` + `assertRegisteredSetMatches` run before the server is
 * built, so a money tool added here is a boot failure, not a runtime surprise.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { daysSince, shiftIsoDate } from "@/server/data/dateShift";
import {
  getOrderItems,
  getRawMembership,
  getRawOrder,
  getRawUser,
  getUserCountry,
  listRawOrdersForUser,
} from "@/server/data/duckdb";
import { lookupMembership } from "@/server/data/demoOverlay";
import { searchPolicy } from "@/server/data/policy";
import { POLICY_SCORE_THRESHOLD } from "@/server/data/policyScore";
import {
  daysUntil,
  fetchPublicHolidays,
  upcomingFrom,
  type Holiday,
} from "@/server/data/holidays";
import { resolveHolidayApiConfig } from "./config";
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

/** How many upcoming holidays a support answer can usefully name without becoming a list. */
const HOLIDAY_LIMIT = 3;

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

  /**
   * What the read tools actually did this turn, in call order.
   *
   * `tools_tried` and `citations` used to be model-authored fields on `create_ticket_stub`.
   * They are observations, not judgements — the runtime watched every one of these calls
   * happen — so asking the model to recall them cost ~10s of output tokens per escalation and
   * produced a worse answer than the ledger: a model can forget a call, misremember whether it
   * succeeded, or invent a citation it never received. One tool server is built per turn, so
   * this array is turn-scoped by construction.
   */
  const ledger: Array<{ tool: string; ok: boolean; summary: string; citation?: string }> = [];

  const record = (
    tool: string,
    ok: boolean,
    summary: string,
    citation?: string,
  ): void => {
    ledger.push(citation === undefined ? { tool, ok, summary } : { tool, ok, summary, citation });
  };

  const getOrder = tool(
    "get_order",
    "Look up one NovaMart order by its numeric id. Read-only. Returns status, order date " +
      "(already expressed on the current calendar), and total. Returns not_found if the id " +
      "does not exist.",
    { order_id: z.number().int().positive() },
    async (args) => {
      const row = await withReadRetry(ctx, "get_order", () => getRawOrder(args.order_id));
      if (row === null) {
        record("get_order", false, `No order ${args.order_id}.`);
        return fail("not_found", `No order ${args.order_id}.`);
      }
      record(
        "get_order",
        true,
        `Order ${row.orderId} is ${row.status}.`,
        `duckdb:orders:${row.orderId}`,
      );
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
      record(
        "get_order_items",
        true,
        `${items.length} line item(s) on order ${args.order_id}.`,
        `duckdb:order_items:${args.order_id}`,
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

  const getProcessingCalendarTool = tool(
    "get_processing_calendar",
    "Public holidays in the customer's own country that fall on or after today, for " +
      "explaining why processing a RETURN can run slow. Read-only. Takes an order " +
      "id, resolves the customer's country from that order, and returns the next few " +
      "nationwide and regional holidays with how many days away each is. This is a calendar, " +
      "not a case system: it never returns a refund date, a shipment, or a tracking number, " +
      "and a holiday is never a promised timeline. If the calendar is unavailable the call " +
      "still succeeds with calendar_available=false — say so plainly and answer from the " +
      "order facts you already have.",
    { order_id: z.number().int().positive() },
    async (args) => {
      const row = await withReadRetry(ctx, "get_processing_calendar", () =>
        getRawOrder(args.order_id),
      );
      if (row === null) {
        return fail("not_found", `No order ${args.order_id}.`);
      }

      const country = await withReadRetry(ctx, "get_processing_calendar", () =>
        getUserCountry(row.userId),
      );
      if (country === null) {
        // Not an error frame: an unknown country is a fact about the dataset, and the agent
        // should keep answering from the order rather than treat the turn as broken.
        record("get_processing_calendar", false, "No country on file for this customer.");
        return ok({
          order_id: row.orderId,
          calendar_available: false,
          reason: "country_unknown",
          as_of: ctx.temporal.asOf,
        });
      }

      const { baseUrl, timeoutMs } = resolveHolidayApiConfig();
      const asOf = ctx.temporal.asOf;
      const year = Number(asOf.slice(0, 4));

      // Two years, because "the next few holidays" from mid-December lives in January. The
      // second call is skipped whenever the current year already answers the question.
      const first = await fetchPublicHolidays(country, year, { baseUrl, timeoutMs });
      if (!first.ok) {
        ctx.tracer.log({
          event: "external_lookup_degraded",
          tool: "get_processing_calendar",
          source: "nager.date",
          reason: first.reason,
        });
        record(
          "get_processing_calendar",
          false,
          `Holiday calendar unavailable (${first.reason}).`,
        );
        return ok({
          order_id: row.orderId,
          country,
          calendar_available: false,
          reason: first.reason,
          as_of: asOf,
        });
      }

      let pool: Holiday[] = upcomingFrom(first.holidays, asOf, HOLIDAY_LIMIT);
      if (pool.length < HOLIDAY_LIMIT) {
        const next = await fetchPublicHolidays(country, year + 1, { baseUrl, timeoutMs });
        // A failed roll-forward is not a failed lookup — this year's holidays still stand.
        if (next.ok) {
          pool = upcomingFrom([...pool, ...next.holidays], asOf, HOLIDAY_LIMIT);
        }
      }

      ctx.tracer.log({
        event: "external_lookup",
        tool: "get_processing_calendar",
        source: "nager.date",
        country,
        cached: first.cached,
        count: pool.length,
      });

      record(
        "get_processing_calendar",
        true,
        `${pool.length} upcoming ${country} holiday(s).`,
        `nager.date:PublicHolidays:${country}:${year}`,
      );
      return ok({
        order_id: row.orderId,
        country,
        calendar_available: true,
        as_of: asOf,
        holidays: pool.map((holiday) => ({
          date: holiday.date,
          name: holiday.name,
          local_name: holiday.localName,
          nationwide: holiday.nationwide,
          days_away: daysUntil(asOf, holiday.date),
        })),
        citation: `nager.date:PublicHolidays:${country}:${year}`,
      });
    },
  );

  const getUserTool = tool(
    "get_user",
    "Look up one NovaMart customer by their numeric user id. Read-only. Returns signup date " +
      "(already expressed on the current calendar), country and primary device. Returns " +
      "not_found if the id does not exist. Contains no payment or address data — this system " +
      "holds neither.",
    { user_id: z.number().int().positive() },
    async (args) => {
      const row = await withReadRetry(ctx, "get_user", () => getRawUser(args.user_id));
      if (row === null) {
        record("get_user", false, `No user ${args.user_id}.`);
        return fail("not_found", `No user ${args.user_id}.`);
      }
      record("get_user", true, `User ${row.userId} in ${row.country}.`, `duckdb:users:${row.userId}`);
      return ok({
        user_id: row.userId,
        country: row.country,
        device_primary: row.devicePrimary,
        signup_date: shiftIsoDate(row.signupDate, ctx.shiftDays),
        as_of: ctx.temporal.asOf,
        citation: `duckdb:users:${row.userId}`,
      });
    },
  );

  const getMembershipTool = tool(
    "get_membership",
    "Look up a customer's NovaMart Plus membership by user id. Read-only. Returns the plan " +
      "type, the recorded status, the start and end dates (already expressed on the current " +
      "calendar), and whether the membership is active as of today. Cannot start, change, " +
      "cancel or refund a membership — no tool in this system can.",
    { user_id: z.number().int().positive() },
    async (args) => {
      // ADR-14 precedence: overlay BEFORE DuckDB. An overlay row is already expressed on the
      // current calendar, so it must not be shifted again — that is the whole point of
      // authoring it as offsets from asOf.
      const persona = lookupMembership(args.user_id, ctx.temporal.asOf);
      if (persona !== null) {
        const activeAsOf =
          persona.endsOn === null || daysSince(persona.endsOn, ctx.temporal.asOf) <= 0;
        const daysRemaining =
          persona.endsOn === null
            ? null
            : Math.max(0, -daysSince(persona.endsOn, ctx.temporal.asOf));
        ctx.tracer.log({
          event: "overlay_hit",
          tool: "get_membership",
          user_id: args.user_id,
          persona: persona.personaLabel,
        });
        record(
          "get_membership",
          true,
          `User ${args.user_id}: ${persona.planType} (${persona.status}), active=${activeAsOf}.`,
          `overlay:memberships:${persona.membershipId}`,
        );
        return ok({
          user_id: args.user_id,
          has_membership: true,
          plan_type: persona.planType,
          status: persona.status,
          started_on: persona.startedOn,
          ends_on: persona.endsOn,
          active_as_of_today: activeAsOf,
          days_remaining: daysRemaining,
          is_trial: persona.planType === "plus_trial",
          other_membership_records: 0,
          as_of: ctx.temporal.asOf,
          citation: `overlay:memberships:${persona.membershipId}`,
        });
      }

      const row = await withReadRetry(ctx, "get_membership", () =>
        getRawMembership(args.user_id),
      );
      if (row === null) {
        // Not an error: "this customer has never had Plus" is a real, useful answer.
        record("get_membership", true, `User ${args.user_id} has no membership record.`);
        return ok({
          user_id: args.user_id,
          has_membership: false,
          as_of: ctx.temporal.asOf,
          citation: `duckdb:memberships:user:${args.user_id}`,
        });
      }

      const startedOn = shiftIsoDate(row.startedAt, ctx.shiftDays);
      const endsOn = row.endedAt === null ? null : shiftIsoDate(row.endedAt, ctx.shiftDays);

      // Computed here, not by the model: "is it still running" is arithmetic on two dates,
      // and a model asked to compare dates in prose gets it wrong often enough to matter.
      // An open-ended row (ended_at IS NULL) is live; otherwise it runs through its end date.
      const activeAsOf = endsOn === null || daysSince(endsOn, ctx.temporal.asOf) <= 0;
      const daysRemaining =
        endsOn === null ? null : Math.max(0, -daysSince(endsOn, ctx.temporal.asOf));

      record(
        "get_membership",
        true,
        `User ${row.userId}: ${row.planType} (${row.status}), active=${activeAsOf}.`,
        `duckdb:memberships:${row.membershipId}`,
      );
      return ok({
        user_id: row.userId,
        has_membership: true,
        plan_type: row.planType,
        status: row.status,
        started_on: startedOn,
        ends_on: endsOn,
        active_as_of_today: activeAsOf,
        days_remaining: daysRemaining,
        is_trial: row.planType === "plus_trial",
        other_membership_records: Math.max(0, row.totalForUser - 1),
        as_of: ctx.temporal.asOf,
        citation: `duckdb:memberships:${row.membershipId}`,
      });
    },
  );

  const listOrdersForUserTool = tool(
    "list_orders_for_user",
    "List a customer's most recent orders by user id, newest first. Read-only. Use when the " +
      "customer does not have an order id to hand. Dates are already on the current calendar.",
    {
      user_id: z.number().int().positive(),
      limit: z.number().int().min(1).max(5).optional(),
    },
    async (args) => {
      const limit = args.limit ?? 5;
      const rows = await withReadRetry(ctx, "list_orders_for_user", () =>
        listRawOrdersForUser(args.user_id, limit),
      );
      record(
        "list_orders_for_user",
        true,
        `${rows.length} recent order(s) for user ${args.user_id}.`,
        `duckdb:orders:user:${args.user_id}`,
      );
      return ok({
        user_id: args.user_id,
        count: rows.length,
        orders: rows.map((row) => ({
          order_id: row.orderId,
          status: row.status,
          order_date: shiftIsoDate(row.orderDate, ctx.shiftDays),
          total_amount: row.totalAmount,
        })),
        as_of: ctx.temporal.asOf,
        citation: `duckdb:orders:user:${args.user_id}`,
      });
    },
  );

  const searchPolicyTool = tool(
    "search_policy",
    "Search NovaMart's written policy corpus (shipping, returns, Plus membership, app " +
      "troubleshooting) and return the matching sections with citation ids. Read-only. " +
      "Sections are returned ONLY when they score at or above the grounding threshold; when " +
      "nothing does, you get grounded=false and NO policy text, which means this system " +
      "cannot answer the question and it must go to a human. Never fill that gap from your " +
      "own knowledge.",
    {
      query: z.string().min(1),
      top_k: z.number().int().min(1).max(5).optional(),
    },
    async (args) => {
      const topK = args.top_k ?? 3;
      // Synchronous, in-memory, and cached after the first turn — no retry wrapper, because
      // there is no transient failure mode to retry. A missing corpus is a boot-level defect.
      const result = searchPolicy(args.query, topK);

      // AC-FAQ-02: the operator trace carries chunk ids AND scores, including for the
      // rejected case — "why did this escalate" is the question an operator actually asks.
      ctx.tracer.log({
        event: "policy_search",
        query: args.query,
        grounded: result.grounded,
        threshold: POLICY_SCORE_THRESHOLD,
        top_score: Number(result.topScore.toFixed(4)),
        chunks: result.grounded
          ? result.hits.map((hit) => ({ id: hit.chunk.id, score: Number(hit.score.toFixed(4)) }))
          : result.rejected.map((hit) => ({ id: hit.id, score: Number(hit.score.toFixed(4)) })),
      });

      if (!result.grounded) {
        // Deliberately NO chunk text on this path (AC-FAQ-01 / AC-FAQ-03). An agent cannot
        // answer from a weak hit it was never shown, which makes "escalate over invent" a
        // property of the tool rather than a request made of the model.
        record(
          "search_policy",
          false,
          `No policy section scored >= ${POLICY_SCORE_THRESHOLD} for "${args.query}".`,
        );
        return ok({
          grounded: false,
          threshold: POLICY_SCORE_THRESHOLD,
          top_score: Number(result.topScore.toFixed(4)),
          chunks: [],
          citations: [],
          guidance:
            "No policy section is close enough to answer this. Tell the coordinator the " +
            "question is not covered by NovaMart policy so it can hand off to a human.",
        });
      }

      const citations = result.hits.map((hit) => hit.chunk.id);
      record(
        "search_policy",
        true,
        `${result.hits.length} policy section(s) for "${args.query}".`,
        citations[0],
      );
      return ok({
        grounded: true,
        threshold: POLICY_SCORE_THRESHOLD,
        top_score: Number(result.topScore.toFixed(4)),
        chunks: result.hits.map((hit) => ({
          id: hit.chunk.id,
          document: hit.chunk.title,
          section: hit.chunk.heading,
          score: Number(hit.score.toFixed(4)),
          text: hit.chunk.text,
          citation: hit.chunk.id,
        })),
        citations,
      });
    },
  );

  const createTicketStubTool = tool(
    "create_ticket_stub",
    "Open a support ticket stub for a human agent. Requires a complete escalation package; " +
      "a partial package is REJECTED rather than written. This does not move money, refund, " +
      "cancel, or charge anything — it only records that a human must take over. You do NOT " +
      "need a conversation id, a list of tools tried, or citations — the runtime supplies all " +
      "three from what it watched happen. Never ask anyone for them.",
    {
      intent: z.string().min(1),
      entities: z.object({
        order_id: z.number().int().optional(),
        user_id: z.number().int().optional(),
        device: z.string().optional(),
        app_version: z.string().optional(),
      }),
      urgency: z.enum(["low", "medium", "high", "critical"]),
      transcript_summary: z.string().min(1),
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
      // conversationId, tools_tried and citations come from the RUNTIME, never the model.
      //
      // conversationId: a subagent only sees the coordinator's delegation prompt, so whether
      // the id reached it was a coin flip — and when it did not, the specialist asked the
      // coordinator for it instead of opening the ticket, so a refund request terminated
      // `resolved` with no stub. A model-supplied id could also name someone else's turn.
      //
      // tools_tried / citations: observations the runtime already made. Asking the model to
      // reproduce them cost ~10s of output tokens per escalation and was strictly less
      // accurate — it can forget a call, misremember an outcome, or cite what it never read.
      const result = createTicketStub(
        {
          ...args,
          conversationId: ctx.conversationId,
          tools_tried: ledger.map(({ tool, ok: succeeded, summary }) => ({
            tool,
            ok: succeeded,
            summary,
          })),
          citations: ledger.flatMap((e) => (e.citation === undefined ? [] : [e.citation])),
        },
        { asOf: ctx.temporal.asOf },
      );
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
    tools: [
      getOrder,
      getOrderItemsTool,
      getUserTool,
      getMembershipTool,
      listOrdersForUserTool,
      getProcessingCalendarTool,
      searchPolicyTool,
      createTicketStubTool,
      formatHandoffSummaryTool,
    ],
  });
}
