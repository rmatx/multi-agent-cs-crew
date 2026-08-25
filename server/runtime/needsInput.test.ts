/**
 * Unit test for the clarifying-question control marker (`server/runtime/needsInput.ts`).
 *
 * The split-delta case is the one that matters: under `SDK_STREAM_MODE=live` the marker can
 * arrive one character at a time, and a filter that missed that would leak "<<NEEDS_INPUT>>"
 * into the customer's chat. Same import-through-runtime-URL trick as `toolRegistry.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./needsInput");

const m = (await import(new URL("./needsInput.ts", import.meta.url).href)) as Mod;

test("plain text passes through untouched and is not flagged", () => {
  const f = m.createMarkerFilter();
  assert.equal(f.push("Your order shipped on 12 March."), "Your order shipped on 12 March.");
  assert.equal(f.flush(), "");
  assert.equal(f.found(), false);
});

test("a marker arriving whole is stripped and flagged", () => {
  const f = m.createMarkerFilter();
  const out = f.push("What is your order number? " + m.NEEDS_INPUT_MARKER);
  assert.equal(out + f.flush(), "What is your order number? ");
  assert.equal(f.found(), true);
});

test("a marker split across deltas never leaks, character by character", () => {
  const f = m.createMarkerFilter();
  const text = "Which order? " + m.NEEDS_INPUT_MARKER;
  let emitted = "";
  for (const ch of text) emitted += f.push(ch);
  emitted += f.flush();
  assert.equal(emitted, "Which order? ");
  assert.equal(f.found(), true);
  assert.ok(!emitted.includes("<<"), "no fragment of the marker may reach the customer");
});

test("a marker split at every possible boundary never leaks", () => {
  const marker = m.NEEDS_INPUT_MARKER;
  for (let i = 0; i <= marker.length; i += 1) {
    const f = m.createMarkerFilter();
    let emitted = f.push("Hi " + marker.slice(0, i));
    emitted += f.push(marker.slice(i));
    emitted += f.flush();
    assert.equal(emitted, "Hi ", `split at ${i}`);
    assert.equal(f.found(), true, `split at ${i}`);
  }
});

test("text that merely resembles the marker prefix is still delivered", () => {
  const f = m.createMarkerFilter();
  let emitted = f.push("Compare a << b");
  emitted += f.flush();
  assert.equal(emitted, "Compare a << b");
  assert.equal(f.found(), false);
});

test("a held partial marker at end of stream is flushed as real text", () => {
  const f = m.createMarkerFilter();
  const emitted = f.push("done <<NEEDS") + f.flush();
  assert.equal(emitted, "done <<NEEDS");
  assert.equal(f.found(), false);
});

test("an answer ending in a question mark is NOT needs_input", () => {
  // The exact false positive the old `endsWith("?")` heuristic produced.
  const stripped = m.stripMarker("It shipped. Anything else I can help with?");
  assert.equal(stripped.found, false);
});

test("stripMarker removes every occurrence", () => {
  const s = m.stripMarker(`a${m.NEEDS_INPUT_MARKER}b${m.NEEDS_INPUT_MARKER}`);
  assert.equal(s.text, "ab");
  assert.equal(s.found, true);
});

test("heldBackLength holds only a real proper prefix", () => {
  assert.equal(m.heldBackLength("hello"), 0);
  assert.equal(m.heldBackLength("hello <<NEEDS"), "<<NEEDS".length);
  assert.equal(m.heldBackLength("hello <"), 1);
});
