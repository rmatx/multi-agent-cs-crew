/**
 * Client-side request validation.
 *
 * This file exists because DEF-12 got all the way to a live demo. `buildChatRequest` had NO
 * tests, and the layers above it all tested the wrong side of the boundary: `eval:sdk` and
 * `evals/run.mjs` POST straight to `/api/chat`, and browser checks only ever drove order-id
 * scenarios. A rule that rejects a turn in the browser is invisible to every suite that starts
 * at the API.
 *
 * The contract being asserted: this function mirrors the SERVER's 400 rules and adds nothing.
 * `ChatRequest.identity` has both `orderId` and `userId` optional, so the client must accept
 * either one alone.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildChatRequest } from "./chatClient";

const base = { message: "Where is my order?", conversationId: null, trace: false };

test("an order id alone is accepted", () => {
  const r = buildChatRequest({ ...base, orderId: "46101", userId: "" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.request.identity, { orderId: 46101 });
});

test("DEF-12: a customer id ALONE is accepted", () => {
  // The exact case that failed live: "What Plus plan am I on?" with customer 38 and no order.
  const r = buildChatRequest({ ...base, message: "What Plus plan am I on?", orderId: "", userId: "38" });
  assert.equal(r.ok, true, "a membership question needs no order number");
  if (!r.ok) return;
  assert.deepEqual(r.request.identity, { userId: 38 });
  assert.equal("orderId" in r.request.identity, false, "must not invent an order id");
});

test("DEF-12: the order-history path works with no order id", () => {
  // `list_orders_for_user` exists precisely to answer without one.
  const r = buildChatRequest({ ...base, message: "What have I ordered recently?", orderId: "", userId: "9970" });
  assert.equal(r.ok, true);
});

test("both ids together are passed through", () => {
  const r = buildChatRequest({ ...base, orderId: "46101", userId: "45344" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.request.identity, { orderId: 46101, userId: 45344 });
});

test("neither id is still rejected — the server could only ask a clarifying question", () => {
  const r = buildChatRequest({ ...base, orderId: "", userId: "" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /order number or a customer id/i);
});

test("non-numeric ids are rejected in whichever field they appear", () => {
  const a = buildChatRequest({ ...base, orderId: "46101x", userId: "" });
  assert.equal(a.ok, false);
  const b = buildChatRequest({ ...base, orderId: "", userId: "abc" });
  assert.equal(b.ok, false);
});

test("message rules are unchanged", () => {
  assert.equal(buildChatRequest({ ...base, message: "   ", orderId: "46101", userId: "" }).ok, false);
  assert.equal(
    buildChatRequest({ ...base, message: "x".repeat(2001), orderId: "46101", userId: "" }).ok,
    false,
  );
});

test("conversationId and trace flow through untouched", () => {
  const r = buildChatRequest({ ...base, orderId: "46101", userId: "", conversationId: "c-1", trace: true });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.request.conversationId, "c-1");
  assert.deepEqual(r.request.clientFlags, { trace: true });
});
