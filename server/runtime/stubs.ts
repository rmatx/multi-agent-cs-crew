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
 *   1. escalation-handoff hardened — DONE for the reason codes (all seven are routed by the
 *      coordinator and accepted by `create_ticket_stub`); the durable store is still layer 5
 *   2. faq-policy + search_policy + 0.55 threshold (ADR-11) — DONE
 *   3. returns-advisor (reuses order tools, no extra hop) — DONE
 *   4. plus-specialist + get_membership — DONE, against real membership rows, plus ONE
 *      DemoOverlay persona (`server/data/demoOverlay.ts`) for the single case the fixture
 *      cannot evidence: a currently-live trial
 *   5. SQLite stores, CSAT, TracePanel UI — outstanding
 */

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

export function notImplemented(feature: string, sadRef: string): never {
  throw new Error(`Not implemented in MVP Sprint 1: ${feature}. See ${sadRef}.`);
}

/* -------------------------------------------------------------------- Data plane ------- */

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
