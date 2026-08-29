/**
 * Rate-limit tests. The window boundary is the part worth pinning: a fixed window that never
 * resets is an outage, and one that resets per request is not a limit at all.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./rateLimit");

const rl = (await import(new URL("./rateLimit.ts", import.meta.url).href)) as Mod;

test("allows up to the limit, then refuses", () => {
  rl.resetRateLimit();
  process.env.RATE_LIMIT_PER_MIN = "3";
  const now = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(rl.checkRateLimit("a", now).allowed, true, `request ${i + 1}`);
  }
  const refused = rl.checkRateLimit("a", now);
  assert.equal(refused.allowed, false);
  assert.ok(refused.allowed === false && refused.retryAfterSeconds > 0);
});

test("the window reopens", () => {
  rl.resetRateLimit();
  process.env.RATE_LIMIT_PER_MIN = "1";
  const now = 2_000_000;
  assert.equal(rl.checkRateLimit("b", now).allowed, true);
  assert.equal(rl.checkRateLimit("b", now + 30_000).allowed, false);
  assert.equal(rl.checkRateLimit("b", now + 60_001).allowed, true);
});

test("keys do not share a bucket", () => {
  rl.resetRateLimit();
  process.env.RATE_LIMIT_PER_MIN = "1";
  const now = 3_000_000;
  assert.equal(rl.checkRateLimit("c", now).allowed, true);
  assert.equal(rl.checkRateLimit("d", now).allowed, true);
  assert.equal(rl.checkRateLimit("c", now).allowed, false);
});

test("0 disables the limit — an explicit operator choice", () => {
  rl.resetRateLimit();
  process.env.RATE_LIMIT_PER_MIN = "0";
  const now = 4_000_000;
  for (let i = 0; i < 50; i += 1) {
    assert.equal(rl.checkRateLimit("e", now).allowed, true);
  }
});

test("a malformed setting falls back to the default rather than to no limit", () => {
  rl.resetRateLimit();
  process.env.RATE_LIMIT_PER_MIN = "not-a-number";
  assert.equal(rl.resolveRateLimit(), 20);
  process.env.RATE_LIMIT_PER_MIN = "-5";
  assert.equal(rl.resolveRateLimit(), 20);
  delete process.env.RATE_LIMIT_PER_MIN;
  assert.equal(rl.resolveRateLimit(), 20);
});
