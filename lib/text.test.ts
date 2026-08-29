/**
 * The rule this file encodes: strip markers the model emits, change nothing else. A stripper
 * that mangles a product name or an order total is worse than the asterisks it removes.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./text");
const { plainText } = (await import(new URL("./text.ts", import.meta.url).href)) as Mod;

test("emphasis markers are removed, content kept", () => {
  assert.equal(
    plainText("I've opened ticket **STUB-63311DF3** with our team."),
    "I've opened ticket STUB-63311DF3 with our team.",
  );
  assert.equal(plainText("__Important__ notice"), "Important notice");
  assert.equal(plainText("that is *really* soon"), "that is really soon");
  assert.equal(plainText("call `get_order` first"), "call get_order first");
});

test("list markers become bullets rather than disappearing", () => {
  assert.equal(
    plainText("Items:\n- Yoga Max x1\n- Water bottle x2"),
    "Items:\n• Yoga Max x1\n• Water bottle x2",
  );
});

test("text that merely contains the characters is left alone", () => {
  // These are the false positives that would make the cure worse than the disease.
  assert.equal(plainText("2 * 3 = 6"), "2 * 3 = 6");
  assert.equal(plainText("order_date and user_id"), "order_date and user_id");
  assert.equal(plainText("policy:returns#return-window"), "policy:returns#return-window");
  assert.equal(plainText("Total $175.05"), "Total $175.05");
  assert.equal(plainText("mcp__novamart__get_order"), "mcp__novamart__get_order");
});

test("plain text passes through untouched", () => {
  const plain = "Order 46101 is completed. Placed today, total $175.05.";
  assert.equal(plainText(plain), plain);
});
