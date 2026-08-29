/**
 * The mock is the frontend's offline stand-in for the wire, so the thing worth testing is not
 * what it says — it is that it says it in the same SHAPE the route does. These assertions are
 * deliberately the same ones `integration.md` makes about the real envelope.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./mockStream");
type Validator = typeof import("@shared/streamEvent");

const { mockStartTurn } = (await import(new URL("./mockStream.ts", import.meta.url).href)) as Mod;
const { parseStreamEvent } = (await import(
  new URL("../../packages/shared/src/streamEvent.ts", import.meta.url).href
)) as Validator;

type Frame = { type: string; [k: string]: unknown };

async function collect(req: Parameters<Mod["mockStartTurn"]>[0]): Promise<Frame[]> {
  const out: Frame[] = [];
  for await (const event of mockStartTurn(req)) out.push(event as Frame);
  return out;
}

test("every frame the mock emits is a valid StreamEvent", async () => {
  for (const req of [
    { message: "Where is my order?", identity: { orderId: 46101 } },
    { message: "Where is my order?" },
    { message: "I want a refund", identity: { orderId: 46101 } },
  ]) {
    for (const frame of await collect(req)) {
      assert.notEqual(parseStreamEvent(frame), null, JSON.stringify(frame));
    }
  }
});

test("session is first and done is last, exactly once each", async () => {
  const frames = await collect({ message: "Where is my order?", identity: { orderId: 1 } });
  assert.equal(frames[0]?.type, "session");
  assert.equal(frames.at(-1)?.type, "done");
  assert.equal(frames.filter((f) => f.type === "done").length, 1);
  assert.equal(frames.filter((f) => f.type === "session").length, 1);
});

test("trace frames are withheld unless the turn asked for them", async () => {
  const off = await collect({ message: "Where is my order?", identity: { orderId: 1 } });
  assert.equal(off.filter((f) => f.type === "agent_hop" || f.type === "tool_call").length, 0);

  const on = await collect({
    message: "Where is my order?",
    identity: { orderId: 1 },
    clientFlags: { trace: true },
  });
  assert.ok(on.some((f) => f.type === "agent_hop"));
  assert.ok(on.some((f) => f.type === "tool_call"));
});

test("csat_prompt sits immediately before done, and never on needs_input", async () => {
  const resolved = await collect({ message: "Where is my order?", identity: { orderId: 1 } });
  const csat = resolved.findIndex((f) => f.type === "csat_prompt");
  const done = resolved.findIndex((f) => f.type === "done");
  assert.ok(csat >= 0);
  assert.equal(done - csat, 1);

  const needsInput = await collect({ message: "Where is my order?" });
  assert.equal(needsInput.some((f) => f.type === "csat_prompt"), false);
  assert.equal(needsInput.at(-1)?.status, "needs_input");
});

test("a money request escalates with a ticket, as the real crew does", async () => {
  const frames = await collect({ message: "I want a refund", identity: { orderId: 46101 } });
  const escalation = frames.find((f) => f.type === "escalation");
  assert.ok(escalation, "no escalation frame");
  assert.equal(escalation["reasonCode"], "payment_or_refund");
  assert.ok(String(escalation["ticketStubId"]).startsWith("STUB-"));
  assert.equal(frames.at(-1)?.status, "escalated");
});

test("a grounded answer carries citations", async () => {
  const frames = await collect({ message: "Where is my order?", identity: { orderId: 46101 } });
  const citation = frames.find((f) => f.type === "citation");
  assert.ok(citation, "no citation frame — the Sources line cannot be developed offline");
  assert.deepEqual(citation["ids"], ["duckdb:orders:46101", "duckdb:order_items:46101"]);
});
