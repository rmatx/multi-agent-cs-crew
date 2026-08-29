/**
 * Turn FSM tests.
 *
 * `integration.md` Open Question 6 recorded that `lib/fsm.ts` and `lib/status.ts` are pure,
 * trivially testable and untested, while `aamad.config.yml` sets
 * `testing.require_unit_tests: true`. They were untested because the client modules import
 * `@shared/dto` and the Node runner could not resolve the alias; `scripts/test-resolver.mjs`
 * (added with the durable stores) removes that obstacle, so the gap has no excuse left.
 *
 * What matters here is the contract the FSM exists to enforce: the CLIENT NEVER DECIDES that
 * a turn ended or how it ended. It learns both from the server.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./fsm");
type Dto = typeof import("@shared/dto");

const fsm = (await import(new URL("./fsm.ts", import.meta.url).href)) as Mod;

type StreamEvent = Parameters<Mod["transition"]>[1] extends { kind: "event"; event: infer E }
  ? E
  : never;

const run = (...events: StreamEvent[]) => {
  let state = fsm.transition(fsm.initialTurnState, { kind: "submit" });
  for (const event of events) state = fsm.transition(state, { kind: "event", event });
  return state;
};

test("a turn starts idle and only submit starts it", () => {
  assert.equal(fsm.initialTurnState.phase, "idle");
  // Events before a submit are ignored: there is no turn for them to belong to.
  const stray = fsm.transition(fsm.initialTurnState, {
    kind: "event",
    event: { type: "token", text: "hello" } as StreamEvent,
  });
  assert.equal(stray.phase, "idle");
});

test("submit while running is ignored, so a double click cannot start two turns", () => {
  const running = fsm.transition(fsm.initialTurnState, { kind: "submit" });
  const again = fsm.transition(running, { kind: "submit" });
  assert.equal(again, running);
});

test("tokens accumulate in order", () => {
  const state = run(
    { type: "token", text: "Order 46101 " } as StreamEvent,
    { type: "token", text: "is completed." } as StreamEvent,
  );
  assert.equal(state.phase === "running" && state.text, "Order 46101 is completed.");
});

test("the server owns terminal status — the client only records it", () => {
  for (const status of ["resolved", "escalated", "needs_input"] as const) {
    const state = run({ type: "done", status } as StreamEvent);
    assert.equal(fsm.statusOf(state), status);
  }
});

test("nothing after done changes the state", () => {
  const done = run({ type: "done", status: "resolved" } as StreamEvent);
  const after = fsm.transition(done, {
    kind: "event",
    event: { type: "token", text: "late" } as StreamEvent,
  });
  assert.deepEqual(after, done);
});

test("an error terminates the turn as escalated and stays retryable", () => {
  const state = run({
    type: "error",
    code: "turn_failed",
    message: "Something went wrong.",
    retryable: true,
  } as StreamEvent);
  assert.equal(fsm.statusOf(state), "escalated");
  assert.equal(fsm.errorOf(state)?.retryable, true);
  assert.equal(fsm.errorOf(state)?.code, "turn_failed");
});

test("the trail records what happened, in arrival order", () => {
  const state = run(
    { type: "session", conversationId: "c1" } as StreamEvent,
    { type: "agent_hop", agentId: "returns-advisor", hop: 1 } as StreamEvent,
    { type: "tool_call", agentId: "returns-advisor", tool: "mcp__novamart__get_order" } as StreamEvent,
    { type: "tool_call", agentId: "returns-advisor", tool: "mcp__novamart__search_policy" } as StreamEvent,
    { type: "citation", ids: ["duckdb:orders:46101"] } as StreamEvent,
    { type: "done", status: "resolved" } as StreamEvent,
  );
  assert.deepEqual(
    fsm.trailOf(state).map((entry) => entry.kind),
    ["hop", "tool", "tool", "citation", "done"],
  );
  assert.equal(fsm.conversationIdOf(state), "c1");
});

test("with trace off the trail is empty, because the server sent no trace frames", () => {
  // Not a filter on the client — the server withholds these frames entirely (SAD §2).
  const state = run(
    { type: "session", conversationId: "c2" } as StreamEvent,
    { type: "token", text: "Your order is on its way." } as StreamEvent,
    { type: "citation", ids: ["duckdb:orders:1"] } as StreamEvent,
    { type: "done", status: "resolved" } as StreamEvent,
  );
  assert.deepEqual(
    fsm.trailOf(state).map((e) => e.kind),
    ["citation", "done"],
  );
  assert.equal(fsm.activityOf(state).agentId, null);
});

test("a hop replaces the activity rather than inheriting the last agent's tool", () => {
  const state = run(
    { type: "agent_hop", agentId: "returns-advisor", hop: 1 } as StreamEvent,
    { type: "tool_call", agentId: "returns-advisor", tool: "mcp__novamart__get_order" } as StreamEvent,
    { type: "agent_hop", agentId: "escalation-handoff", hop: 2 } as StreamEvent,
  );
  const activity = fsm.activityOf(state);
  assert.equal(activity.agentId, "escalation-handoff");
  assert.equal(activity.tool, null, "the new agent has not called anything yet");
  assert.equal(activity.hops, 2);
});

test("an escalation is readable back with its ticket", () => {
  const state = run(
    { type: "escalation", ticketStubId: "STUB-ABC12345", reasonCode: "payment_or_refund" } as StreamEvent,
    { type: "done", status: "escalated" } as StreamEvent,
  );
  assert.deepEqual(fsm.escalationOf(state), {
    ticketStubId: "STUB-ABC12345",
    reasonCode: "payment_or_refund",
  });
});

test("csat_prompt is a UI cue, not a step in the turn", () => {
  const state = run(
    { type: "csat_prompt" } as StreamEvent,
    { type: "done", status: "resolved" } as StreamEvent,
  );
  assert.deepEqual(
    fsm.trailOf(state).map((e) => e.kind),
    ["done"],
  );
});

test("reset returns to idle and drops the conversation", () => {
  const state = fsm.transition(run({ type: "session", conversationId: "c3" } as StreamEvent), {
    kind: "reset",
  });
  assert.equal(state.phase, "idle");
  assert.equal(fsm.conversationIdOf(state), null);
  assert.deepEqual(fsm.trailOf(state), []);
});

test("a new turn keeps the conversation id, so the server sees one conversation", () => {
  const first = run(
    { type: "session", conversationId: "c4" } as StreamEvent,
    { type: "done", status: "resolved" } as StreamEvent,
  );
  const second = fsm.transition(first, { kind: "submit" });
  assert.equal(fsm.conversationIdOf(second), "c4");
  assert.deepEqual(fsm.trailOf(second), [], "a new turn starts with a clean trail");
});
