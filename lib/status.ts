/**
 * The one place crew status is named and coloured.
 *
 * Banner, pill, buttons and inline messages all read from here, so a status can
 * never be called "running" in one place and "Sending…" in another. Adding a
 * status means adding it once, in this file.
 *
 * Tones follow the agreed vocabulary — gray idle, blue running, green done, red error — plus
 * two that are neither success nor failure:
 *
 *   `attention` (amber)  the turn stopped and is waiting on the CUSTOMER (`needs_input`).
 *   `handoff`   (violet) the turn ended and a PERSON now has it (`escalated`).
 *
 * Those two shared one tone and one label until 2026-08-28, and the shared label was "needs
 * input". A turn that opened ticket STUB-E0420689 and told the customer a human would pick it
 * up was therefore announced as "needs input" — the banner asking them to do something while
 * the answer below said the opposite. Neither is a failure, so neither is green; but they ask
 * opposite things of the reader and cannot share a word.
 */

import type { TurnActivity, TurnState } from "@/lib/fsm";
import { activityOf, errorOf } from "@/lib/fsm";

export type StatusTone = "idle" | "running" | "done" | "attention" | "handoff" | "error";

export type CrewStatus = {
  tone: StatusTone;
  /** Banner text, e.g. "running". */
  label: string;
  /** One short line under the banner explaining what the label means. */
  hint: string;
  /**
   * What the banner may honestly call itself. There is only a crew on the `sdk` engine; the
   * deterministic engine is a coded lookup with no agent in it, and labelling that "Crew"
   * claims the capstone's headline feature on a path that does not implement it.
   */
  prefix: string;
  /**
   * Who is working and on what, e.g. "Order specialist · reading the order". `null` whenever
   * the turn is not running, or when the frames that carry it were not requested — see
   * `TurnActivity`. A null detail renders nothing; it never renders a guess.
   */
  detail: string | null;
};

/**
 * Display names for the registered agents (`REGISTERED_AGENT_IDS` in server/runtime/agents.ts).
 * An unknown id is shown verbatim rather than dropped: a new agent appearing in the banner
 * under its raw id is a smaller problem than the banner quietly omitting it.
 */
const AGENT_NAMES: Record<string, string> = {
  "triage-router": "Triage",
  "order-specialist": "Order specialist",
  "faq-policy": "Policy specialist",
  "plus-specialist": "Plus specialist",
  "returns-advisor": "Returns advisor",
  "escalation-handoff": "Escalation",
};

/**
 * What each tool is doing, in the customer's terms rather than the registry's. Keyed on the
 * bare tool name — the `mcp__novamart__` prefix is stripped first.
 */
const TOOL_ACTIONS: Record<string, string> = {
  get_order: "reading the order",
  get_order_items: "reading the line items",
  get_user: "reading the account",
  list_orders_for_user: "listing recent orders",
  get_membership: "checking the membership",
  search_policy: "checking NovaMart policy",
  get_processing_calendar: "checking the holiday calendar",
  create_ticket_stub: "opening a ticket",
  format_handoff_summary: "writing the handoff",
  Agent: "handing off",
};

export function agentName(agentId: string): string {
  return AGENT_NAMES[agentId] ?? agentId;
}

/**
 * The crew, in the order a turn travels through it: triage first, the four specialists it can
 * choose between, and the escalation path out to a person.
 *
 * Ordered rather than alphabetical because the strip that renders it is read as a flow — a
 * viewer should see WHERE in the crew a question landed, not just which name lit up.
 */
export const CREW_ORDER: readonly string[] = [
  "triage-router",
  "order-specialist",
  "faq-policy",
  "plus-specialist",
  "returns-advisor",
  "escalation-handoff",
];

/** Bare tool name, MCP prefix stripped — what an operator reads in a trace. */
export function toolName(tool: string): string {
  return tool.replace(/^mcp__[^_]+__/, "");
}

export function toolAction(tool: string): string {
  const bare = toolName(tool);
  return TOOL_ACTIONS[bare] ?? `calling ${bare}`;
}

/** "Order specialist · reading the order", or just the agent, or null when nothing is known. */
function describe(activity: TurnActivity): string | null {
  if (activity.agentId === null) return null;
  const who = agentName(activity.agentId);
  const what = activity.tool === null ? null : toolAction(activity.tool);
  return what === null ? who : `${who} · ${what}`;
}

/** Turn engine reported by `/api/health`. `null` until that resolves. */
export type EngineId = "deterministic" | "sdk" | null;

const STATUS: Record<StatusTone, { label: string; hint: string }> = {
  idle: { label: "idle", hint: "Waiting for an order number and a question." },
  running: { label: "running", hint: "Looking that up." },
  done: { label: "done", hint: "Answered from order data." },
  attention: { label: "needs input", hint: "Waiting on you before it can answer." },
  handoff: { label: "handed off", hint: "A person has this now." },
  error: { label: "error", hint: "The turn did not complete." },
};

export function crewStatus(state: TurnState, engine: EngineId = null): CrewStatus {
  const tone = toneOf(state);
  // Detail is running-only. A finished turn showing "Escalation · opening a ticket" would
  // read as still in progress.
  const detail = tone === "running" ? describe(activityOf(state)) : null;
  return { tone, ...STATUS[tone], prefix: enginePrefix(engine), detail };
}

function enginePrefix(engine: EngineId): string {
  if (engine === "sdk") return "Crew";
  if (engine === "deterministic") return "Support";
  return "Status"; // engine not known yet — claim nothing
}

function toneOf(state: TurnState): StatusTone {
  if (state.phase === "idle") return "idle";
  if (state.phase === "running") return "running";
  if (errorOf(state) !== null) return "error";
  if (state.status === "resolved") return "done";
  return state.status === "escalated" ? "handoff" : "attention";
}

/** Button label for the primary control, phrased to match the banner. */
export function runLabel(state: TurnState): string {
  return state.phase === "running" ? "Running…" : "Run";
}

/** hh:mm:ss for the "last updated" readout. Local time; seconds matter here. */
export function formatUpdated(at: Date): string {
  return at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}


/**
 * Why this turn went to a human, in the customer's words rather than the registry's.
 * Unknown codes fall back to the raw value: a reason nobody has phrased yet is still better
 * shown than swallowed.
 */
const REASON_LABELS: Record<string, string> = {
  payment_or_refund: "money movement — refunds, payments, billing",
  restricted_action: "a change this assistant cannot make",
  customer_requested_human: "you asked for a person",
  ungrounded: "not covered by NovaMart policy or data",
  low_confidence: "the answer was not confident enough to send",
  repeat_failure: "the assistant ran out of handoffs for this turn",
  high_severity: "this needs a person quickly",
};

export function reasonLabel(reasonCode: string): string {
  return REASON_LABELS[reasonCode] ?? reasonCode.replace(/_/g, " ");
}
