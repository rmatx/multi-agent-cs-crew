/**
 * Hop-accounting and tool-authorization hook tests — **AC-ORCH-01 and AC-ORCH-02**.
 *
 * WHY THESE EXIST AS UNIT TESTS. AC-ORCH-02 (max hops, then escalate with `repeat_failure`)
 * was verified live on 2026-08-28 and could not be reproduced on 2026-08-29: routing had
 * improved to the point where the coordinator answers a two-part question in ONE hop, so a
 * customer-surface fixture can no longer reliably drive the budget to exhaustion. That is a
 * good product outcome and a bad test: an acceptance criterion whose evidence depends on a
 * model choosing to make two handoffs is not evidence.
 *
 * The hook is a pure function of (budget, input). Tested here, AC-ORCH-02 is covered
 * deterministically and stays covered whatever the router decides.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Hooks = typeof import("./hooks");
const hooks = (await import(new URL("./hooks.ts", import.meta.url).href)) as Hooks;

/** Collects trace records so a denial can be asserted on what it LOGGED, not just returned. */
function recorder() {
  const records: Array<Record<string, unknown>> = [];
  return { records, log: (r: Record<string, unknown>) => void records.push(r) };
}

function context(maxHops: number) {
  const tracer = recorder();
  const budget = hooks.createHopBudget(maxHops);
  return {
    budget,
    tracer,
    ctx: {
      tracer: tracer as unknown as Parameters<Hooks["buildHooks"]>[0]["tracer"],
      budget,
      emitTrace: () => {},
      toolsTried: [],
      citations: [],
      escalation: {},
    } as Parameters<Hooks["buildHooks"]>[0],
  };
}

/** One PreToolUse input. `agent_type` absent means the coordinator itself. */
function preToolUse(tool: string, opts: { agent?: string; target?: string } = {}) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: tool,
    ...(opts.agent === undefined ? {} : { agent_type: opts.agent }),
    tool_input: opts.target === undefined ? {} : { subagent_type: opts.target },
  } as unknown as Parameters<
    NonNullable<ReturnType<Hooks["buildHooks"]>["PreToolUse"]>[number]["hooks"][number]
  >[0];
}

async function runPreToolUse(ctx: Parameters<Hooks["buildHooks"]>[0], input: unknown) {
  const built = hooks.buildHooks(ctx);
  const hook = built.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "PreToolUse hook must be registered");
  return (await hook(input as never, undefined as never, {} as never)) as {
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
  };
}

const decision = (out: { hookSpecificOutput?: { permissionDecision?: string } }) =>
  out.hookSpecificOutput?.permissionDecision;
const reason = (out: { hookSpecificOutput?: { permissionDecisionReason?: string } }) =>
  out.hookSpecificOutput?.permissionDecisionReason ?? "";

test("AC-ORCH-01: a tool outside an agent's allowlist is denied", async () => {
  const { ctx } = context(4);
  // order-specialist may not open tickets; escalation-handoff may not read orders.
  const wrongWay = await runPreToolUse(
    ctx,
    preToolUse("mcp__novamart__create_ticket_stub", { agent: "order-specialist" }),
  );
  assert.equal(decision(wrongWay), "deny");

  const allowed = await runPreToolUse(
    ctx,
    preToolUse("mcp__novamart__get_order", { agent: "order-specialist" }),
  );
  assert.notEqual(decision(allowed), "deny");
});

test("AC-ORCH-01: an unknown agent is denied by default", async () => {
  const { ctx } = context(4);
  const out = await runPreToolUse(
    ctx,
    preToolUse("mcp__novamart__get_order", { agent: "agent-that-does-not-exist" }),
  );
  assert.equal(decision(out), "deny", "unknown agent must fail closed");
});

test("a money-shaped tool name is denied even though none is registered", async () => {
  const { ctx, tracer } = context(4);
  const out = await runPreToolUse(ctx, preToolUse("issue_refund", { agent: "order-specialist" }));
  assert.equal(decision(out), "deny");
  assert.match(reason(out), /refund|payment|cancellation/i);
  assert.ok(tracer.records.some((r) => r["reason"] === "money_tool"));
});

test("only the coordinator may delegate, whatever a specialist is told", async () => {
  const { ctx } = context(4);
  const out = await runPreToolUse(
    ctx,
    preToolUse("Agent", { agent: "order-specialist", target: "plus-specialist" }),
  );
  assert.equal(decision(out), "deny");
});

test("AC-ORCH-02: with the budget spent, a further handoff is denied", async () => {
  const { ctx, budget, tracer } = context(2);
  budget.hops = 2; // as if two transfers already happened this turn

  const out = await runPreToolUse(ctx, preToolUse("Agent", { target: "plus-specialist" }));
  assert.equal(decision(out), "deny");
  // The denial must TELL the coordinator the legal exit, not merely refuse.
  assert.match(reason(out), /escalation-handoff/);
  assert.match(reason(out), /repeat_failure/);
  assert.equal(budget.exhausted, true, "the engine keys its forced escalation on this flag");
  assert.ok(
    tracer.records.some((r) => r["event"] === "hop_budget_exhausted"),
    "an operator must be able to see why the turn ended",
  );
});

test("AC-ORCH-02: the terminal agent stays reachable when the budget is spent", async () => {
  // Otherwise a hop-exhausted turn would have no legal exit at all — the customer would be
  // left with neither an answer nor a human.
  const { ctx, budget } = context(2);
  budget.hops = 2;
  const out = await runPreToolUse(ctx, preToolUse("Agent", { target: "escalation-handoff" }));
  assert.notEqual(decision(out), "deny");
});

test("the budget is checked BEFORE the transfer, not after", async () => {
  const { ctx, budget } = context(1);
  budget.hops = 0;
  assert.notEqual(
    decision(await runPreToolUse(ctx, preToolUse("Agent", { target: "order-specialist" }))),
    "deny",
    "the first hop of a maxHops=1 turn must be allowed",
  );
  budget.hops = 1;
  assert.equal(
    decision(await runPreToolUse(ctx, preToolUse("Agent", { target: "order-specialist" }))),
    "deny",
    "the second must not",
  );
});

test("a hop is an agent transfer — tool calls never consume the budget", async () => {
  const { ctx, budget } = context(1);
  budget.hops = 1; // budget already spent
  // Each tool paired with an agent that actually holds it: the first draft of this test used
  // order-specialist for `search_policy` and the denial it got was correct AUTHORIZATION, not
  // a budget refusal. Worth keeping the note — the two failure modes look identical from the
  // outside, and only one of them is a bug.
  for (const [agent, tool] of [
    ["order-specialist", "mcp__novamart__get_order"],
    ["order-specialist", "mcp__novamart__get_order_items"],
    ["order-specialist", "mcp__novamart__list_orders_for_user"],
    ["faq-policy", "mcp__novamart__search_policy"],
    ["plus-specialist", "mcp__novamart__get_membership"],
    ["returns-advisor", "mcp__novamart__search_policy"],
    ["escalation-handoff", "mcp__novamart__create_ticket_stub"],
  ] as const) {
    assert.notEqual(
      decision(await runPreToolUse(ctx, preToolUse(tool, { agent }))),
      "deny",
      `${agent} → ${tool} must not be blocked by a spent HOP budget`,
    );
  }
});
