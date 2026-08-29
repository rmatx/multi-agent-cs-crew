/**
 * The guard decides whether a turn may end without consulting anyone. A false negative lets
 * the assistant answer a customer from model memory — the failure the whole architecture is
 * built to prevent — so the ungrounded direction is tested hardest.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./groundingGuard");

const g = (await import(new URL("./groundingGuard.ts", import.meta.url).href)) as Mod;

const NO_EVIDENCE = { hops: 0, escalated: false, needsInput: false };

test("bare pleasantries need no specialist", () => {
  for (const message of [
    "hi", "Hi!", "Hello there", "hey", "Good morning", "thanks", "Thank you so much!",
    "cheers", "ok thanks", "Got it.", "bye", "That's all", "no thanks",
  ]) {
    assert.equal(g.requiresSpecialist(message), false, message);
  }
});

test("anything with a question or a request in it needs a specialist", () => {
  for (const message of [
    "What is the capital of France?",
    "Where is my order?",
    "hi, where is my order",          // a greeting is not a licence for what follows
    "thanks — can I still return it?",
    "Tell me about your return policy",
    "I want a refund",
    "is the trial still running",
    "",                                // nothing to answer is not a licence either
    "   ",
  ]) {
    assert.equal(g.requiresSpecialist(message), true, JSON.stringify(message));
  }
});

test("a turn that consulted nobody about a real question is unaided", () => {
  assert.equal(g.isUnaidedAnswer("What is the capital of France?", NO_EVIDENCE), true);
});

test("evidence of any kind clears the guard", () => {
  const message = "What is the capital of France?";
  assert.equal(g.isUnaidedAnswer(message, { ...NO_EVIDENCE, hops: 1 }), false);
  assert.equal(g.isUnaidedAnswer(message, { ...NO_EVIDENCE, escalated: true }), false);
  assert.equal(g.isUnaidedAnswer(message, { ...NO_EVIDENCE, needsInput: true }), false);
});

test("a greeting answered with no hops is fine", () => {
  assert.equal(g.isUnaidedAnswer("hi", NO_EVIDENCE), false);
  assert.equal(g.isUnaidedAnswer("thanks!", NO_EVIDENCE), false);
});
