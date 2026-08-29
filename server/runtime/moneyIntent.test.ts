/**
 * Money-intent classifier tests (ADR-16).
 *
 * This is a SAFETY list: a false negative means a customer asking for a refund on the default
 * engine never reaches a human, which is the defect INT-01 recorded. A false positive costs a
 * human's attention on a question the engine could have answered. Both directions are tested,
 * and the negative cases are the ones that matter for over-escalation.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./moneyIntent");

const m = (await import(new URL("./moneyIntent.ts", import.meta.url).href)) as Mod;

test("money requests are detected", () => {
  for (const message of [
    "I want a refund",
    "refund me now",
    "Can I get my money back?",
    "REFUND",
    "cancel my order",
    "Please cancel this",
    "I'd like to cancel",
    "I was charged twice",
    "why was I charged for this",
    "there is a payment issue",
    "I have a billing question",
    "I was billed the wrong amount",
    "I want to file a chargeback",
    "I need to dispute this charge",
    "please reimburse me",
    "can you send an invoice",
  ]) {
    assert.equal(m.isMoneyRequest(message), true, message);
  }
});

test("ordinary support questions are NOT money requests", () => {
  for (const message of [
    "Where is my order?",
    "what was in my order",
    "I sent this order back. Where does my return stand?",
    "when will it arrive",
    "the app keeps crashing",
    "what is your return policy",
    "do you ship to Canada",
    "any other details on the order",
  ]) {
    assert.equal(m.isMoneyRequest(message), false, message);
  }
});

test("a cancelled STATUS question does not escalate, a cancel REQUEST does", () => {
  // The distinction the lookahead exists for. Asking about a cancellation that already
  // happened is answerable from the order row; asking to cancel is not.
  assert.equal(m.isMoneyRequest("why was my order cancelled"), false);
  assert.equal(m.isMoneyRequest("my order was canceled already"), false);
  assert.equal(m.isMoneyRequest("Was this order cancelled?"), false);
  assert.equal(m.isMoneyRequest("cancel my order"), true);
  assert.equal(m.isMoneyRequest("I am cancelling this"), true);
});

test("empty and whitespace input is not a money request", () => {
  assert.equal(m.isMoneyRequest(""), false);
  assert.equal(m.isMoneyRequest("   "), false);
});
