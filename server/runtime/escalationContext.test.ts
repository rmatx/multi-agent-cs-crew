/**
 * AC-TRIAGE-03 / AC-TICKET-01 / AC-ESC-05.
 *
 * The false positives matter more than the hits here. A ticket that says "android 175.05"
 * because the customer mentioned a total is worse than one with no version at all: it sends
 * an engineer somewhere specific and wrong.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./escalationContext");
const m = (await import(new URL("./escalationContext.ts", import.meta.url).href)) as Mod;

test("AC-TRIAGE-03: device and version are captured when stated", () => {
  assert.deepEqual(m.extractAppContext("The app crashes on Android 3.2.0 when I open my basket"), {
    device: "android",
    app_version: "3.2.0",
  });
  assert.deepEqual(m.extractAppContext("iPhone app version 3.2 keeps closing"), {
    device: "ios",
    app_version: "3.2",
  });
  assert.deepEqual(m.extractAppContext("crashes in the browser on v4.10"), {
    device: "web",
    app_version: "4.10",
  });
});

test("either field may be absent, and an absent field is not guessed", () => {
  assert.deepEqual(m.extractAppContext("The app keeps crashing"), {});
  assert.deepEqual(m.extractAppContext("My Android app crashes"), { device: "android" });
  assert.deepEqual(m.extractAppContext("It crashes on 3.2.0"), { app_version: "3.2.0" });
});

test("numbers that are not versions are never filed as versions", () => {
  // Every one of these appears in real replies from this system.
  for (const message of [
    "My order total was $175.05",
    "Processing takes 3 to 5 business days",
    "I ordered 2 of them at 12.99 each",
    "Order 46101 placed on 2026-09-01",
    "I have been waiting 3.5 weeks",
  ]) {
    assert.equal(
      m.extractAppContext(message).app_version,
      undefined,
      `must not read a version out of: ${message}`,
    );
  }
});

test("a bare two-part number needs a v/version label", () => {
  assert.equal(m.extractAppContext("it broke in 3.2").app_version, undefined);
  assert.equal(m.extractAppContext("it broke in version 3.2").app_version, "3.2");
  assert.equal(m.extractAppContext("it broke in v3.2").app_version, "3.2");
});

test("AC-ESC-05: the normative intent to category map", () => {
  const expected: Record<string, string> = {
    order_status: "delivery_issue",
    shipping_policy: "delivery_issue",
    payment_question: "payment_issue",
    returns_policy: "product_quality",
    plus_membership: "membership_issue",
    account_question: "account_issue",
    app_issue: "other",
    human_request: "other",
    other: "other",
  };
  for (const [intent, category] of Object.entries(expected)) {
    assert.equal(m.categoryForIntent(intent), category, intent);
  }
});

test("ADR-13: app_issue is `other` even when the model supplies something specific", () => {
  // The case most likely to be got wrong by reasoning from the words: "app issue" sounds
  // specific and the category deliberately is not.
  assert.equal(m.categoryForIntent("app_issue", "app_bug"), "other");
  assert.equal(m.categoryForIntent("APP_ISSUE", "technical"), "other");
  assert.equal(m.categoryForIntent(" order_status ", "something_else"), "delivery_issue");
});

test("an unrecognised intent keeps a supplied category rather than losing it", () => {
  assert.equal(m.categoryForIntent("future_intent", "specialist_category"), "specialist_category");
  assert.equal(m.categoryForIntent("future_intent"), "other");
  assert.equal(m.categoryForIntent("future_intent", "  "), "other");
});
