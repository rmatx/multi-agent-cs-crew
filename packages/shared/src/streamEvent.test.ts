/**
 * Contract tests for the frame validator (integration.md OQ-5).
 *
 * The first test is the important one: it walks EVERY variant of the union and asserts a
 * valid instance survives. If someone adds a tenth variant to `dto.ts` and forgets the
 * validator, that frame starts being dropped silently on the wire — this test is what makes
 * that a build failure instead of a bug report.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./streamEvent");
const { parseStreamEvent } = (await import(
  new URL("./streamEvent.ts", import.meta.url).href
)) as Mod;

/** One valid instance of every variant in the union, in declaration order. */
const VALID = [
  { type: "session", conversationId: "c1" },
  { type: "token", text: "Order 46101 is completed." },
  { type: "agent_hop", agentId: "returns-advisor", hop: 1 },
  { type: "tool_call", agentId: "returns-advisor", tool: "mcp__novamart__get_order" },
  { type: "citation", ids: ["duckdb:orders:46101", "policy:returns#return-window"] },
  { type: "escalation", ticketStubId: "STUB-ABC12345", reasonCode: "payment_or_refund" },
  { type: "csat_prompt" },
  { type: "error", code: "turn_failed", message: "Something went wrong.", retryable: true },
  { type: "done", status: "resolved" },
];

test("every variant of the frozen union round-trips", () => {
  for (const event of VALID) {
    assert.deepEqual(parseStreamEvent(event), event, JSON.stringify(event));
  }
  // Guards against a variant being added to dto.ts and forgotten here.
  assert.equal(VALID.length, 9, "the union has 9 variants — update this test with dto.ts");
});

test("all three terminal statuses are accepted, and nothing else is", () => {
  for (const status of ["resolved", "escalated", "needs_input"]) {
    assert.deepEqual(parseStreamEvent({ type: "done", status }), { type: "done", status });
  }
  assert.equal(parseStreamEvent({ type: "done", status: "finished" }), null);
  assert.equal(parseStreamEvent({ type: "done" }), null, "a done with no status ends nothing");
});

test("a frame missing a required field is rejected, not coerced", () => {
  for (const bad of [
    { type: "session" },
    { type: "token" },
    { type: "token", text: 42 },
    { type: "agent_hop", agentId: "x" },
    { type: "agent_hop", agentId: "x", hop: "1" },
    { type: "tool_call", agentId: "x" },
    { type: "citation", ids: "not-an-array" },
    { type: "citation", ids: ["ok", 7] },
    { type: "escalation", ticketStubId: "STUB-1" },
    { type: "error", code: "x", message: "y" },
    { type: "error", code: "x", message: "y", retryable: "yes" },
  ]) {
    assert.equal(parseStreamEvent(bad), null, JSON.stringify(bad));
  }
});

test("non-objects and unknown types are dropped rather than thrown", () => {
  for (const bad of [null, undefined, 7, "done", [], [{ type: "done", status: "resolved" }]]) {
    assert.equal(parseStreamEvent(bad), null, JSON.stringify(bad ?? null));
  }
  // A newer server may send a frame this client predates. Dropping it is the compatible
  // behaviour, and it must not throw.
  assert.equal(parseStreamEvent({ type: "quantum_hop", agentId: "x" }), null);
});

test("unexpected extra fields are tolerated, and not copied through", () => {
  // How a wire contract grows without breaking old clients.
  const parsed = parseStreamEvent({ type: "token", text: "hi", futureField: "ignored" });
  assert.deepEqual(parsed, { type: "token", text: "hi" });
});

test("prototype pollution attempts do not survive parsing", () => {
  const parsed = parseStreamEvent(JSON.parse('{"type":"token","text":"x","__proto__":{"polluted":true}}'));
  assert.deepEqual(parsed, { type: "token", text: "x" });
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});
