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

/**
 * DEF-08 regression. Every one of these opened a real support ticket in the 2026-08-29 QA
 * pass — four of the eight sign-offs sampled — because pleasantries were matched as whole
 * phrases and a natural closing is a compound of two.
 */
test("DEF-08: compound sign-offs do not open a ticket", () => {
  for (const message of [
    "Thanks, that is all",
    "ok thanks, bye",
    "great, thank you!",
    "that's all, cheers",
    "thanks so much, bye!",
    "perfect, thank you",
    "ok cool thanks",
    "no thanks, that's all",
    "thanks for your help",
    "got it, cheers",
    "alright thanks bye",
  ]) {
    assert.equal(g.requiresSpecialist(message), false, message);
    assert.equal(g.isUnaidedAnswer(message, NO_EVIDENCE), false, message);
  }
});

test("DEF-08: the fix does not open a hole — content words still require a specialist", () => {
  for (const message of [
    "hi, where is my order",           // the case the whole-phrase rule got right
    "thanks, but where is my refund",
    "ok bye, cancel my membership",
    "great, now tell me my order status",
    "thanks. is that all you can do about the refund",
    "Is that all?",                     // pleasantry words, but a question
    "thanks?",
  ]) {
    assert.equal(g.requiresSpecialist(message), true, message);
  }
});

test("a long message is never a sign-off, whatever words it uses", () => {
  const wordy = "thanks thanks thanks thanks thanks thanks thanks thanks thanks thanks thanks";
  assert.equal(g.requiresSpecialist(wordy), true);
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
