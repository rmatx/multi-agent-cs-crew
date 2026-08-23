/**
 * Zero-money-tools invariant test (SAD §9 "Security: no refund tools registered",
 * NFR-SAFE-01). Run with `npm run test:invariants`.
 *
 * Uses the Node built-in test runner + native TypeScript type stripping, so it adds no
 * dependency. The module under test is imported through a runtime URL rather than a static
 * specifier because `tsc --noEmit` rejects `.ts` import extensions without
 * `allowImportingTsExtensions`, and Node's stripper requires them. `toolRegistry.ts` has no
 * imports of its own, so nothing else needs to resolve.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Registry = typeof import("./toolRegistry");

const registry = (await import(
  new URL("./toolRegistry.ts", import.meta.url).href
)) as Registry;

test("the registered tool set is exactly the reviewed Sprint 1 set", () => {
  assert.deepEqual(
    [...registry.REGISTERED_TOOL_NAMES].sort(),
    ["create_ticket_stub", "format_handoff_summary", "get_order", "get_order_items"],
  );
});

test("no registered tool is a money tool", () => {
  assert.doesNotThrow(() => registry.assertNoMoneyTools(registry.REGISTERED_TOOL_NAMES));
});

test("no tool anywhere in the MVP contract is a money tool", () => {
  assert.doesNotThrow(() => registry.assertNoMoneyTools(registry.MVP_TOOL_CONTRACT));
});

test("no agent allowlist grants a money tool", () => {
  for (const [agentId, tools] of Object.entries(registry.AGENT_TOOL_ALLOWLIST)) {
    assert.doesNotThrow(
      () => registry.assertNoMoneyTools(tools),
      `agent ${agentId} allowlist`,
    );
  }
});

test("money vocabulary is actually detected", () => {
  for (const name of [
    "issue_refund",
    "cancel_order",
    "capture_payment",
    "mcp__novamart__process_chargeback",
    "UpdateBillingCard",
  ]) {
    assert.equal(registry.isMoneyToolName(name), true, name);
  }
  assert.throws(() => registry.assertNoMoneyTools(["get_order", "issue_refund"]), {
    message: /NFR-SAFE-01 violation/,
  });
});

test("drift in the registered set is a hard failure", () => {
  assert.doesNotThrow(() =>
    registry.assertRegisteredSetMatches(registry.REGISTERED_TOOL_NAMES),
  );
  assert.throws(
    () =>
      registry.assertRegisteredSetMatches([
        ...registry.REGISTERED_TOOL_NAMES,
        "get_membership",
      ]),
    { message: /Tool registry drift/ },
  );
});

test("only the coordinator holds the delegation tool", () => {
  const holders = Object.entries(registry.AGENT_TOOL_ALLOWLIST)
    .filter(([, tools]) =>
      tools.some((t) => (registry.DELEGATION_TOOL_ALIASES as readonly string[]).includes(t)),
    )
    .map(([agentId]) => agentId);
  assert.deepEqual(holders, ["triage-router"]);
});

test("no agent holds a built-in shell / write / network tool", () => {
  const granted = new Set(registry.allAllowedToolNames());
  for (const builtin of registry.FORBIDDEN_BUILTIN_TOOLS) {
    assert.equal(granted.has(builtin), false, builtin);
  }
});

test("specialists cannot delegate, structurally", () => {
  assert.equal(registry.isToolAllowedForAgent("order-specialist", "Agent"), false);
  assert.equal(registry.isToolAllowedForAgent("order-specialist", "Task"), false);
  assert.equal(
    registry.isToolAllowedForAgent("order-specialist", "mcp__novamart__get_order"),
    true,
  );
  assert.equal(registry.isToolAllowedForAgent("unknown-agent", "mcp__novamart__get_order"), false);
});
