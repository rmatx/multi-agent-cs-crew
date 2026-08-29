/**
 * Budget-resolution tests — DEF-07.
 *
 * The rule being pinned: **unset falls back, set-but-invalid throws.** Those are different
 * situations and used to share an outcome, which is how `MAX_HOPS=0` came to be silently
 * executed as 4 while the Audit recorded 4 and the operator believed 0.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./config");
const config = (await import(new URL("./config.ts", import.meta.url).href)) as Mod;

const BUDGET_VARS = [
  "MAX_HOPS",
  "MAX_MODEL_TURNS",
  "TURN_TIMEOUT_MS",
  "MAX_OUTPUT_TOKENS",
  "TOOL_READ_RETRIES",
  "MAX_THINKING_TOKENS",
];

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const name of BUDGET_VARS) saved[name] = process.env[name];
  for (const name of BUDGET_VARS) delete process.env[name];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  try {
    return run();
  } finally {
    for (const name of BUDGET_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test("unset budgets fall back to the SAD defaults", () => {
  withEnv({}, () => {
    const b = config.resolveBudgets();
    assert.equal(b.maxHops, 4, "SAD §2: maxHops=4");
    assert.equal(b.maxModelTurns, 12);
    assert.equal(b.turnTimeoutMs, 120_000);
    assert.equal(b.maxOutputTokens, 4_096);
    assert.equal(b.toolReadRetries, 1);
    assert.equal(b.thinkingBudgetTokens, undefined, "unset stays unset for adaptive thinking");
  });
});

test("an explicit value is used, not quietly replaced", () => {
  withEnv({ MAX_HOPS: "2", TURN_TIMEOUT_MS: "45000" }, () => {
    const b = config.resolveBudgets();
    assert.equal(b.maxHops, 2);
    assert.equal(b.turnTimeoutMs, 45_000);
  });
});

test("DEF-07: zero is honoured where it is meaningful", () => {
  // "Never delegate" and "do not retry" are real operator choices. Before the fix both were
  // silently executed as the default.
  withEnv({ MAX_HOPS: "0" }, () => {
    assert.equal(config.resolveBudgets().maxHops, 0);
  });
  withEnv({ TOOL_READ_RETRIES: "0" }, () => {
    assert.equal(config.resolveBudgets().toolReadRetries, 0);
  });
});

test("DEF-07: a typo throws instead of becoming the default", () => {
  for (const bad of ["1o", "banana", "", " ", "4.5", "-1", "1e3x", "NaN"]) {
    if (bad.trim().length === 0) continue; // empty means unset, tested above
    assert.throws(
      () => withEnv({ MAX_HOPS: bad }, () => config.resolveBudgets()),
      /MAX_HOPS/,
      `MAX_HOPS="${bad}" must be rejected loudly`,
    );
  }
});

test("DEF-07: zero is still rejected where it is meaningless", () => {
  for (const name of ["TURN_TIMEOUT_MS", "MAX_MODEL_TURNS", "MAX_OUTPUT_TOKENS"]) {
    assert.throws(
      () => withEnv({ [name]: "0" }, () => config.resolveBudgets()),
      new RegExp(name),
      `${name}=0 has no useful meaning and must not be accepted`,
    );
  }
});

test("the error names the variable, the value, and what to do", () => {
  try {
    withEnv({ MAX_HOPS: "1o" }, () => config.resolveBudgets());
    assert.fail("expected a throw");
  } catch (err) {
    const message = (err as Error).message;
    assert.match(message, /MAX_HOPS/);
    assert.match(message, /1o/, "an operator must see the value they actually set");
    assert.match(message, /unset it/, "and be told the way out");
  }
});
