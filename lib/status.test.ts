/**
 * Status vocabulary tests.
 *
 * The banner is the one place the UI states what happened in its own words, so the mapping
 * from turn state to those words is worth pinning. The case that motivated this file: an
 * escalated turn — ticket opened, human engaged — was announced as "needs input", telling the
 * customer to act while the answer beneath it said a person had taken over.
 */

import assert from "node:assert/strict";
import test from "node:test";

type FsmMod = typeof import("./fsm");
type StatusMod = typeof import("./status");

const fsm = (await import(new URL("./fsm.ts", import.meta.url).href)) as FsmMod;
const status = (await import(new URL("./status.ts", import.meta.url).href)) as StatusMod;

type StreamEvent = Parameters<FsmMod["transition"]>[1] extends { kind: "event"; event: infer E }
  ? E
  : never;

const ended = (...events: StreamEvent[]) => {
  let state = fsm.transition(fsm.initialTurnState, { kind: "submit" });
  for (const event of events) state = fsm.transition(state, { kind: "event", event });
  return state;
};

test("each terminal outcome gets its own word", () => {
  const resolved = status.crewStatus(ended({ type: "done", status: "resolved" } as StreamEvent));
  const escalated = status.crewStatus(ended({ type: "done", status: "escalated" } as StreamEvent));
  const needsInput = status.crewStatus(
    ended({ type: "done", status: "needs_input" } as StreamEvent),
  );

  assert.equal(resolved.tone, "done");
  assert.equal(escalated.tone, "handoff");
  assert.equal(needsInput.tone, "attention");

  // The specific bug: these two must not share a label.
  assert.notEqual(escalated.label, needsInput.label);
  assert.match(escalated.label, /handed off/i);
  assert.match(needsInput.label, /needs input/i);
});

test("the banner never calls a keyless lookup a crew", () => {
  const state = ended({ type: "done", status: "resolved" } as StreamEvent);
  assert.equal(status.crewStatus(state, "sdk").prefix, "Crew");
  assert.equal(status.crewStatus(state, "deterministic").prefix, "Support");
  // Engine not yet known: claim nothing.
  assert.equal(status.crewStatus(state, null).prefix, "Status");
});

test("activity detail is running-only", () => {
  let state = fsm.transition(fsm.initialTurnState, { kind: "submit" });
  state = fsm.transition(state, {
    kind: "event",
    event: { type: "agent_hop", agentId: "order-specialist", hop: 1 } as StreamEvent,
  });
  state = fsm.transition(state, {
    kind: "event",
    event: { type: "tool_call", agentId: "order-specialist", tool: "mcp__novamart__get_order" } as StreamEvent,
  });
  assert.equal(status.crewStatus(state).detail, "Order specialist · reading the order");

  // A finished turn showing "Escalation · opening a ticket" would read as still in progress.
  const done = fsm.transition(state, {
    kind: "event",
    event: { type: "done", status: "resolved" } as StreamEvent,
  });
  assert.equal(status.crewStatus(done).detail, null);
});

test("an unknown agent or tool is shown, not swallowed", () => {
  assert.equal(status.agentName("brand-new-agent"), "brand-new-agent");
  assert.equal(status.toolName("mcp__novamart__get_order"), "get_order");
  assert.match(status.toolAction("mcp__novamart__do_something_new"), /do_something_new/);
});

test("reason codes are phrased for a customer, and unknown ones still read", () => {
  assert.match(status.reasonLabel("payment_or_refund"), /money/i);
  assert.match(status.reasonLabel("customer_requested_human"), /person/i);
  assert.equal(status.reasonLabel("some_future_code"), "some future code");
});
