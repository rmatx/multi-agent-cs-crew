/**
 * MVP agent roster (`*define-agents`) — SAD §2 "Runtime roles": main agent = `triage-router`
 * coordinator; specialists are `AgentDefinition` entries in `ClaudeAgentOptions.agents`,
 * invoked via the `Agent` tool. PRD §3.2 is the source for each role's goal and boundaries.
 *
 * DELEGATION IS STRUCTURAL, NOT TEXTUAL. Specialists do not receive the `Agent` tool in their
 * `tools` array, and `disallowedTools` names it explicitly for good measure. A specialist
 * cannot spawn another specialist even if a prompt injection tells it to, because the
 * capability is absent — not because the prompt asks it nicely.
 *
 * Registered here = Sprint 1 (SAD "Sprint 1 — thin vertical slice"): triage-router (main),
 * order-specialist (Slice A), escalation-handoff (Slice B). `faq-policy`, `plus-specialist`
 * and `returns-advisor` are Sprint 2 and live as INERT drafts in `stubs.ts` — registering an
 * agent whose tools do not exist would invite an ungrounded answer, which is the exact
 * failure mode PRD "escalate over invent" forbids.
 */

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTemporalView } from "./engine";
import {
  AGENT_TOOL_ALLOWLIST,
  DELEGATION_TOOL_ALIASES,
  FORBIDDEN_BUILTIN_TOOLS,
} from "./toolRegistry";

/** Applied to every specialist: no delegation, no shell, no filesystem, no network. */
const SPECIALIST_DISALLOWED: string[] = [
  ...DELEGATION_TOOL_ALIASES,
  ...FORBIDDEN_BUILTIN_TOOLS,
];

/** Shared safety preamble. Belt; `toolRegistry` + hooks are the braces. */
const SAFETY_RULES = [
  "You never process refunds, cancellations, payments, or billing changes. No tool in this",
  "system can do those things; if the customer asks, hand off to escalation-handoff.",
  "State facts only from tool results — never from memory or inference. If a tool did not",
  "give you the fact, you do not have it: escalate instead of guessing.",
].join(" ");

function timeRules(temporal: AgentTemporalView): string {
  return [
    `Today's date is ${temporal.asOf}.`,
    "Dates returned by tools are already on the current calendar — use them as-is, never",
    "adjust or recompute them, and never speculate about how they were produced.",
  ].join(" ");
}

/**
 * The coordinator's system prompt. It is the ONLY agent that talks to the customer, which is
 * what makes "one assistant voice" (SAD §2) true by construction rather than by convention.
 */
export function coordinatorPrompt(temporal: AgentTemporalView, maxHops: number): string {
  return [
    "You are NovaMart's customer support assistant. The customer sees only your voice.",
    "",
    SAFETY_RULES,
    timeRules(temporal),
    "",
    "How you work:",
    "- Classify the message into one intent: order_status, plus_membership, returns_policy,",
    "  shipping_policy, app_issue, payment_question, account_question, human_request, other.",
    "- If the intent is order_status and you have an order id, delegate to order-specialist",
    "  via the Agent tool.",
    "- If the intent is payment_question or human_request, or the customer asks for a refund,",
    "  cancellation, or any money movement, delegate to escalation-handoff. That is terminal.",
    "- plus_membership, returns_policy, shipping_policy, app_issue and account_question have",
    "  no specialist in this build. Delegate them to escalation-handoff with an honest",
    "  reason; do not answer them yourself.",
    "- Act on what you already have. `known_identity` is what the customer has ALREADY given",
    "  you. If it supplies the id an intent needs, proceed immediately — never ask the",
    "  customer to confirm, verify, or authorise a lookup, and never ask 'would you like me",
    "  to...'. They asked the question; retrieving the answer is what they want.",
    "- Ask a question ONLY when a required id is genuinely absent from `known_identity`. Then",
    "  ask ONE short clarifying question and stop. Asking costs no delegation.",
    `- You may delegate at most ${maxHops} times per turn; the runtime enforces this and will`,
    "  refuse further delegation. When refused, escalate.",
    "",
    "Style: reply to the customer in plain sentences. Do not narrate your routing, do not",
    "mention agents, tools, or internal steps, and do not think out loud — the customer sees",
    "one assistant, not a crew.",
  ].join("\n");
}

/** SAD Sprint 1 registered specialists. Keys are the `subagent_type` the coordinator uses. */
export function buildAgentDefinitions(
  temporal: AgentTemporalView,
): Record<string, AgentDefinition> {
  const orderTools = AGENT_TOOL_ALLOWLIST["order-specialist"] ?? [];
  const escalationTools = AGENT_TOOL_ALLOWLIST["escalation-handoff"] ?? [];

  return {
    "order-specialist": {
      description:
        "Order and line-item facts: status, dates, totals, items. Use for order_status when " +
        "an order id is known. Cannot cancel, refund, or change an order.",
      tools: [...orderTools],
      disallowedTools: SPECIALIST_DISALLOWED,
      prompt: [
        "You are the NovaMart order specialist (PRD F-ORDER-01).",
        "",
        SAFETY_RULES,
        timeRules(temporal),
        "",
        "Call get_order, and get_order_items when the customer asks about contents. Report",
        "status, order date, total and items exactly as the tools returned them. Include the",
        "`citation` value from each tool result in your reply so the coordinator can cite it.",
        "If get_order returns not_found, say so plainly and do not speculate.",
        "You cannot cancel orders, issue refunds, or change an address — say a human must do",
        "that and let the coordinator escalate.",
        "",
        "Return a compact factual summary for the coordinator. Do not address the customer",
        "directly and do not write a greeting or sign-off.",
      ].join("\n"),
    },

    "escalation-handoff": {
      description:
        "Terminal handoff to a human. Use for refunds, payments, cancellations, explicit " +
        "human requests, ungrounded questions, and exhausted hop budgets.",
      tools: [...escalationTools],
      disallowedTools: SPECIALIST_DISALLOWED,
      prompt: [
        "You are the NovaMart escalation handler (PRD F-ESC-01 / F-TICKET-01).",
        "",
        SAFETY_RULES,
        timeRules(temporal),
        "",
        "Build a COMPLETE escalation package and call create_ticket_stub with it:",
        "conversationId, intent, entities (order_id / user_id when known), urgency,",
        "transcript_summary (customer-safe, no raw tool JSON), tools_tried, citations,",
        "reason_code, suggested_category. A partial package is rejected by the tool — if it",
        "is rejected, fix the named fields and call it once more.",
        "",
        "reason_code for refund / payment / chargeback asks is `payment_or_refund`.",
        "For an app issue, suggested_category is `other` (ADR-13).",
        "",
        "Then call format_handoff_summary with the returned ticket_stub_id and return that",
        "summary plus the ticket id to the coordinator. Do not promise a refund, a timeline,",
        "or any outcome.",
      ].join("\n"),
    },
  };
}

/** Agent ids that may appear in `agent_hop` trace frames this build. */
export const REGISTERED_AGENT_IDS = [
  "triage-router",
  "order-specialist",
  "escalation-handoff",
] as const;
