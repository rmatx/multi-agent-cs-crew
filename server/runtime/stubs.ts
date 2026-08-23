/**
 * Non-MVP / Sprint 2 surface (`*stub-nonmvp`) — INERT ON PURPOSE.
 *
 * Nothing in this file is registered, imported by the runtime, or reachable from a turn.
 * It exists so the deferred work has a named home and a SAD reference instead of living in
 * somebody's head. Every stub either throws `notImplemented()` or is a plain data draft.
 *
 * Rule for whoever picks these up: a stub must NEVER return plausible-looking fake data. An
 * agent that receives invented policy text will present it as grounded fact, which is the
 * precise failure PRD "escalate over invent" forbids. Throw, or don't register.
 *
 * Order of work is fixed by SAD "Sprint 2 layer order":
 *   1. escalation-handoff hardened — remaining six ReasonCodes + durable TicketStubStore
 *   2. faq-policy + search_policy + 0.55 threshold (ADR-11)
 *   3. returns-advisor (reuses order tools, no extra hop)
 *   4. plus-specialist + membership overlay
 *   5. SQLite stores, CSAT, TracePanel UI
 */

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

export function notImplemented(feature: string, sadRef: string): never {
  throw new Error(`Not implemented in MVP Sprint 1: ${feature}. See ${sadRef}.`);
}

/* ------------------------------------------------------------------ Sprint 2 agents ---- */

/**
 * Drafted, NOT registered. `buildAgentDefinitions()` deliberately does not include these:
 * an agent whose tools do not exist can only answer from model memory.
 * Register each one in the same commit that registers its tools.
 */
export const UNREGISTERED_AGENT_DRAFTS: Readonly<Record<string, Partial<AgentDefinition>>> = {
  // SAD Sprint 2 layer 2 — needs `search_policy` + the 0.55 threshold (ADR-11).
  "faq-policy": {
    description:
      "INERT DRAFT — answer shipping / returns / Plus / app-troubleshooting questions from " +
      "the policy corpus only, with citations. Escalate when no chunk scores ≥ 0.55.",
  },
  // SAD Sprint 2 layer 4 — needs `get_membership` + membership overlay.
  "plus-specialist": {
    description:
      "INERT DRAFT — Plus trial / paid / cancelled status from the membership record plus " +
      "the Plus policy subset. Never starts or cancels billing.",
  },
  // SAD Sprint 2 layer 3 — reuses the order tools; costs no extra hop.
  "returns-advisor": {
    description:
      "INERT DRAFT — return eligibility against the asOf window. Advises only; a refund " +
      "request routes to escalation-handoff.",
  },
};

/* ------------------------------------------------------------------- Sprint 2 tools ---- */

/**
 * SAD §2 tool contracts not yet registered. Signatures are here so the shape is settled;
 * the bodies throw. NONE of these move money — the MVP tool surface has no such contract and
 * `toolRegistry.MONEY_TOOL_PATTERNS` would reject one at boot if somebody added it.
 */
export const unimplementedTools = {
  /** `{ user_id } → user row summary` (triage, plus). */
  getUser: (_userId: number): never => notImplemented("get_user", "SAD §2 tool contracts"),
  /** `{ user_id, limit ≤ 5 } → orders[]` (order). */
  listOrdersForUser: (_userId: number, _limit: number): never =>
    notImplemented("list_orders_for_user", "SAD §2 tool contracts"),
  /** `{ user_id } → membership summary` (plus). Dates must go through DateShiftMapper. */
  getMembership: (_userId: number): never =>
    notImplemented("get_membership", "SAD §2 tool contracts"),
  /** `{ query, top_k } → { chunks[], citations[] }` (faq, plus, returns). ADR-11. */
  searchPolicy: (_query: string, _topK: number): never =>
    notImplemented("search_policy", "SAD ADR-11 / PRD AC-FAQ-01"),
};

/* -------------------------------------------------------------------- Data plane ------- */

/**
 * DemoOverlay (ADR-14 / F-TIME-01): 3–5 hand-authored personas checked BEFORE DuckDB, with
 * dates already asOf-relative. Until it exists, `TemporalMeta.overlayHit` is honestly
 * reported as `false` rather than faked — see `server/data/dateShift.ts`.
 */
export const demoOverlay = {
  lookupOrder: (_orderId: number): never =>
    notImplemented("DemoOverlay.lookupOrder", "SAD §4 temporal layer / ADR-14"),
};

/**
 * Durable stores (ADR-10). Sprint 1 uses in-memory session state and the in-memory ticket
 * stub store in `escalation.ts`, which SAD Sprint 1 explicitly permits.
 */
export const durableStores = {
  /** `data/sessions.sqlite` — SessionState + transcript + CSAT. */
  sessionStore: (): never => notImplemented("SQLite SessionStore", "SAD ADR-10"),
  /** `data/ticket_stubs.sqlite` — EscalationPackage rows that survive a restart. */
  ticketStubStore: (): never => notImplemented("SQLite TicketStubStore", "SAD ADR-10"),
};

/* ---------------------------------------------------------------- Deferred features ---- */

/**
 * Explicitly OUT of the MVP (SAD §1 "Core vs Future", PRD P2/OUT). Listed so nobody
 * re-derives them as "obviously missing":
 *   - F-WRITE-01 refund / cancel writes  — the reason NFR-SAFE-01 exists. Never in this repo
 *                                          without a new PRD and a human-approval gate.
 *   - F-ANALYTICS-01 Scenario D dashboard
 *   - F-COP-01 L1 copilot UI, omnichannel
 *   - Zendesk / carrier / payment integrations
 *   - MCP servers (ADR-07: MVP tools are in-process)
 *   - Session resume / fork across turns
 *   - Rate limiting (429 in the SAD error table) and the operator-key auth on the trace API
 */
export const OUT_OF_MVP = [
  "F-WRITE-01 refund/cancel writes",
  "F-ANALYTICS-01 analytics dashboard",
  "F-COP-01 L1 copilot UI",
  "external MCP servers",
  "session resume/fork",
  "rate limiting + operator-key auth",
] as const;
