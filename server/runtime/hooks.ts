/**
 * Lifecycle hooks: hop accounting, tool authorization, and the operator trace
 * (SAD §2 "Lifecycle hooks", "Hop accounting (normative)"; adapter Logging + Tools).
 *
 * These hooks are the ENFORCEMENT layer. Everything the prompts in `agents.ts` ask for
 * politely is also made true here mechanically:
 *
 *   PreToolUse    L4 of the zero-money-tools defence + per-agent allowlist + hop-budget
 *                 refusal on the delegation tool.
 *   SubagentStart Hop accounting. A hop is an AGENT TRANSFER, not a tool call, so `hops`
 *                 increments here and nowhere else (SAD hop table).
 *   PostToolUse   Trace + tool outcome for the escalation package's `tools_tried`.
 *   SubagentStop  Hop close-out; subagent text is logged for operators, never streamed.
 */

import type { HookCallbackMatcher, HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { StreamEvent } from "@shared/dto";
import {
  DELEGATION_TOOL_ALIASES,
  isMoneyToolName,
  isToolAllowedForAgent,
} from "./toolRegistry";
import type { Tracer } from "./trace";

/** Agent id used for anything on the main thread (the coordinator). */
const COORDINATOR_ID = "triage-router";

/** Terminal specialist: reachable even when the hop budget is spent (SAD hop accounting). */
const TERMINAL_AGENT = "escalation-handoff";

export type HopBudget = {
  readonly maxHops: number;
  hops: number;
  /** Agents entered this turn, in order — feeds `SessionState.lastAgents`. */
  readonly path: string[];
  /** True once the budget forced an escalation; the engine reports `repeat_failure`. */
  exhausted: boolean;
};

export function createHopBudget(maxHops: number): HopBudget {
  return { maxHops, hops: 0, path: [], exhausted: false };
}

export type ToolAttempt = { tool: string; ok: boolean; summary: string };

/** Populated when `create_ticket_stub` succeeds; drives the terminal `escalation` frame. */
export type EscalationOutcome = { ticketStubId?: string; reasonCode?: string };

export type HookContext = {
  readonly tracer: Tracer;
  readonly budget: HopBudget;
  /** Emits `agent_hop` / `tool_call` frames. Trace-gated by the engine, not here. */
  readonly emitTrace: (event: StreamEvent) => void;
  /** Accumulated for the escalation package and the operator trace. */
  readonly toolsTried: ToolAttempt[];
  /** Citation ids harvested from tool results, so grounding is observed, not claimed. */
  readonly citations: string[];
  readonly escalation: EscalationOutcome;
};

function agentIdOf(input: HookInput): string {
  const agentType = (input as { agent_type?: string }).agent_type;
  return agentType !== undefined && agentType.length > 0 ? agentType : COORDINATOR_ID;
}

function isDelegation(toolName: string): boolean {
  return (DELEGATION_TOOL_ALIASES as readonly string[]).includes(toolName);
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  } as HookJSONOutput;
}

function allow(): HookJSONOutput {
  return { continue: true } as HookJSONOutput;
}

/**
 * Pull `citation` ids and a created `ticket_stub_id` out of a tool response.
 *
 * Grounding and escalation are recorded from what the TOOL returned, never from what the
 * model said it did — that difference is the whole point of "tools over memory" (SAD §1).
 * Tool payloads are JSON inside MCP text blocks, so the scan is over the serialised form.
 */
function harvest(
  ctx: HookContext,
  toolName: string,
  toolInput: unknown,
  response: unknown,
  failed: boolean,
): void {
  if (failed) return;
  let serialised: string;
  try {
    serialised = JSON.stringify(response) ?? "";
  } catch {
    return;
  }
  for (const match of serialised.matchAll(/\\?"citation\\?":\\?"([^"\\]+)/g)) {
    const id = match[1];
    if (id !== undefined && !ctx.citations.includes(id)) ctx.citations.push(id);
  }
  if (toolName.endsWith("create_ticket_stub")) {
    const stub = /\\?"ticket_stub_id\\?":\\?"([^"\\]+)/.exec(serialised);
    if (stub?.[1] !== undefined) {
      ctx.escalation.ticketStubId = stub[1];
      // The reason code the tool was CALLED with — the stub was written from these args.
      const reason = (toolInput as { reason_code?: unknown } | null)?.reason_code;
      if (typeof reason === "string") ctx.escalation.reasonCode = reason;
    }
  }
}

/**
 * Build the hook table for one turn. Hooks close over per-turn state, so two concurrent
 * chats cannot share a hop counter.
 */
export function buildHooks(
  ctx: HookContext,
): Partial<Record<"PreToolUse" | "PostToolUse" | "SubagentStart" | "SubagentStop", HookCallbackMatcher[]>> {
  const preToolUse = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") return allow();
    const toolName = input.tool_name;
    const agentId = agentIdOf(input);

    // L4a — money vocabulary. Unreachable by construction (nothing is bound), which is
    // exactly why it is cheap to keep: it costs nothing and covers a future mistake.
    if (isMoneyToolName(toolName)) {
      ctx.tracer.log({ event: "tool_denied", reason: "money_tool", agentId, tool: toolName });
      return deny(
        "Denied: this system has no refund, cancellation, or payment capability. " +
          "Hand off to escalation-handoff instead.",
      );
    }

    // L4b — hop budget, checked BEFORE the transfer (SAD: "The budget is checked before a
    // handoff"). The forced escalation handoff is exempt — otherwise a hop-exhausted turn
    // would have no legal exit.
    if (isDelegation(toolName)) {
      const target = (input.tool_input as { subagent_type?: string } | null)?.subagent_type;
      if (
        ctx.budget.hops >= ctx.budget.maxHops &&
        target !== TERMINAL_AGENT
      ) {
        ctx.budget.exhausted = true;
        ctx.tracer.log({
          event: "hop_budget_exhausted",
          hops: ctx.budget.hops,
          maxHops: ctx.budget.maxHops,
          attempted: target ?? "unknown",
        });
        return deny(
          `Hop budget (${ctx.budget.maxHops}) is spent. Delegate to ${TERMINAL_AGENT} with ` +
            "reason_code=repeat_failure.",
        );
      }
      if (agentId !== COORDINATOR_ID) {
        // Structurally impossible (specialists have no Agent tool) — belt and braces.
        ctx.tracer.log({ event: "tool_denied", reason: "specialist_delegation", agentId });
        return deny("Only the coordinator may delegate.");
      }
      return allow();
    }

    // L4c — per-agent least-privilege allowlist.
    if (!isToolAllowedForAgent(agentId, toolName)) {
      ctx.tracer.log({ event: "tool_denied", reason: "not_allowlisted", agentId, tool: toolName });
      return deny(`Denied: ${agentId} is not permitted to call ${toolName}.`);
    }

    ctx.emitTrace({ type: "tool_call", agentId, tool: toolName });
    ctx.tracer.log({ event: "tool_call", agentId, tool: toolName, input: input.tool_input });
    return allow();
  };

  const postToolUse = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PostToolUse") return allow();
    const agentId = agentIdOf(input);
    const response = input.tool_response;
    const failed =
      typeof response === "object" &&
      response !== null &&
      (response as { isError?: boolean }).isError === true;
    ctx.toolsTried.push({
      tool: input.tool_name,
      ok: !failed,
      summary: failed ? "tool reported an error" : "ok",
    });
    harvest(ctx, input.tool_name, input.tool_input, response, failed);
    ctx.tracer.log({
      event: "tool_result",
      agentId,
      tool: input.tool_name,
      ok: !failed,
      durationMs: input.duration_ms,
      response,
    });
    return allow();
  };

  const subagentStart = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "SubagentStart") return allow();
    // THE hop counter. Tool calls never reach this hook, which is what makes
    // "a hop is an agent transfer, not a tool call" true in code.
    ctx.budget.hops += 1;
    ctx.budget.path.push(input.agent_type);
    ctx.emitTrace({ type: "agent_hop", agentId: input.agent_type, hop: ctx.budget.hops });
    ctx.tracer.log({
      event: "agent_hop",
      agentId: input.agent_type,
      agentRunId: input.agent_id,
      hop: ctx.budget.hops,
      maxHops: ctx.budget.maxHops,
    });
    return allow();
  };

  const subagentStop = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "SubagentStop") return allow();
    // Specialist output is operator-visible only. It is never streamed as a `token`
    // frame — the customer hears one voice (SAD §2).
    ctx.tracer.log({
      event: "agent_stop",
      agentId: input.agent_type,
      agentRunId: input.agent_id,
      hops: ctx.budget.hops,
      lastMessage: input.last_assistant_message,
    });
    return allow();
  };

  return {
    PreToolUse: [{ hooks: [preToolUse] }],
    PostToolUse: [{ hooks: [postToolUse] }],
    SubagentStart: [{ hooks: [subagentStart] }],
    SubagentStop: [{ hooks: [subagentStop] }],
  };
}
