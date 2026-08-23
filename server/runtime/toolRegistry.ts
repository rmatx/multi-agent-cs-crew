/**
 * Tool-name registry and the ZERO-MONEY-TOOLS invariant (SAD §2 "Forbidden in MVP",
 * NFR-SAFE-01, Sprint 1 exit criterion "zero money tools registered in the process").
 *
 * THIS MODULE HAS NO IMPORTS, ON PURPOSE. It is the single source of truth for which tool
 * names may exist, and it is loaded by:
 *   1. `server/runtime/tools.ts`      — startup assertion before the MCP server is built
 *   2. `server/runtime/hooks.ts`      — PreToolUse denial layer
 *   3. `server/runtime/agents.ts`     — per-agent `tools` allowlists
 *   4. `server/runtime/toolRegistry.test.ts` — exact-set unit test (`npm run test:invariants`)
 *
 * Keeping it import-free means the invariant test can load it under `node --test` type
 * stripping without dragging in Next, DuckDB, or the Agent SDK.
 *
 * Defence in depth — four INDEPENDENT layers, none of which is a prompt instruction:
 *   L1  Nothing bound.       No refund / cancel / payment function exists in this process.
 *   L2  Startup assertion.   `assertNoMoneyTools()` throws before any agent can be created.
 *   L3  Exact-set test.      The registered set must equal a hard-coded literal, so *adding*
 *                            a tool fails CI even if its name looks innocent.
 *   L4  PreToolUse denial.   Runtime hook denies anything outside the per-agent allowlist.
 */

/** In-process MCP server name; tool names reach the model as `mcp__novamart__<tool>`. */
export const MCP_SERVER_NAME = "novamart";

export function mcpToolName(tool: string): string {
  return `mcp__${MCP_SERVER_NAME}__${tool}`;
}

/**
 * The full MVP tool surface from SAD §2 "Tool contracts (MVP)". Declared here so the
 * invariant covers tools Sprint 2 will add, not just the ones wired today.
 */
export const MVP_TOOL_CONTRACT = [
  "get_user",
  "get_order",
  "get_order_items",
  "list_orders_for_user",
  "get_membership",
  "search_policy",
  "create_ticket_stub",
  "format_handoff_summary",
] as const;

/**
 * What is ACTUALLY registered in this process today (SAD Sprint 1: Slice A order read +
 * Slice B escalation stub). Sprint 2 tools are deliberately absent rather than faked —
 * see `server/runtime/stubs.ts`.
 */
export const REGISTERED_TOOL_NAMES = [
  "get_order",
  "get_order_items",
  "create_ticket_stub",
  "format_handoff_summary",
] as const;

export type RegisteredToolName = (typeof REGISTERED_TOOL_NAMES)[number];

/** Built-in SDK tools. MVP grants NONE of these to any agent (SAD §2 tool permissions). */
export const FORBIDDEN_BUILTIN_TOOLS = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Read",
  "Glob",
  "Grep",
] as const;

/** The one delegation tool the coordinator holds. Specialists never receive it. */
export const DELEGATION_TOOL = "Agent";

/** Historical / alternate spellings of the delegation tool, denied for non-coordinators. */
export const DELEGATION_TOOL_ALIASES = ["Agent", "Task"] as const;

/**
 * Money / mutation vocabulary. Substring match on a lowercased tool name. Deliberately
 * broad: a false positive is a build error you fix in seconds, a false negative is an
 * unsafe action against a customer's card.
 */
export const MONEY_TOOL_PATTERNS = [
  "refund",
  "chargeback",
  "charge",
  "payment",
  "pay_",
  "_pay",
  "billing",
  "bill_",
  "card",
  "invoice",
  "credit",
  "debit",
  "capture",
  "settle",
  "void",
  "disburse",
  "reimburse",
  "cancel",
  "price_adjust",
  "adjust_price",
  "checkout",
  "transfer",
  "payout",
  "subscribe",
  "unsubscribe",
] as const;

export function isMoneyToolName(name: string): boolean {
  const lowered = name.toLowerCase();
  return MONEY_TOOL_PATTERNS.some((pattern) => lowered.includes(pattern));
}

/**
 * L2 — startup assertion. Throws (not returns) so a violation is a hard boot failure of the
 * sdk engine rather than a log line somebody scrolls past.
 */
export function assertNoMoneyTools(toolNames: readonly string[]): void {
  const offenders = toolNames.filter(isMoneyToolName);
  if (offenders.length > 0) {
    throw new Error(
      `NFR-SAFE-01 violation: money/mutation tool(s) registered: ${offenders.join(", ")}. ` +
        "The MVP crew advises only; refunds, cancellations and payments are human-only.",
    );
  }
}

/**
 * L2b — the registered set must be exactly what we declared. Catches a tool that was added
 * to the MCP server but never reviewed here.
 */
export function assertRegisteredSetMatches(actual: readonly string[]): void {
  const expected = [...REGISTERED_TOOL_NAMES].sort();
  const got = [...actual].sort();
  const same =
    expected.length === got.length && expected.every((name, i) => name === got[i]);
  if (!same) {
    throw new Error(
      `Tool registry drift: expected exactly [${expected.join(", ")}], got [${got.join(", ")}]. ` +
        "Update REGISTERED_TOOL_NAMES and its unit test deliberately, never incidentally.",
    );
  }
}

/**
 * Per-agent allowlists (SAD §2 tool contracts, PRD §3.2). Values are MCP-qualified names
 * plus, for the coordinator only, the delegation tool. Sprint 2 agents are absent because
 * they are not registered — see `stubs.ts`.
 */
export const AGENT_TOOL_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  "triage-router": [DELEGATION_TOOL],
  "order-specialist": [mcpToolName("get_order"), mcpToolName("get_order_items")],
  "escalation-handoff": [
    mcpToolName("create_ticket_stub"),
    mcpToolName("format_handoff_summary"),
  ],
};

/** L4 helper — used by the PreToolUse hook. Unknown agent ⇒ deny. */
export function isToolAllowedForAgent(agentId: string, toolName: string): boolean {
  if (isMoneyToolName(toolName)) return false;
  const allow = AGENT_TOOL_ALLOWLIST[agentId];
  if (allow === undefined) return false;
  return allow.includes(toolName);
}

/** Every tool name any agent may ever see, for the global `allowedTools` option. */
export function allAllowedToolNames(): string[] {
  const seen = new Set<string>();
  for (const names of Object.values(AGENT_TOOL_ALLOWLIST)) {
    for (const name of names) seen.add(name);
  }
  return [...seen].sort();
}
