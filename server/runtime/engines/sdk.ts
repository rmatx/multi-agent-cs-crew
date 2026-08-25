/**
 * claude-agent-sdk turn engine — OPT-IN via `CHAT_ENGINE=sdk` (SAD §2 "Runtime roles",
 * adapter Mapping/Execution). NOT the default: `deterministic` is, and this module is only
 * ever reached through a dynamic import so an unconfigured SDK cannot affect that path.
 *
 * Shape of a turn:
 *   preflight (key + model)  → clean `error` frame if unconfigured, never a crash
 *   tool server              → in-process MCP, read-only, zero money tools
 *   agents                   → coordinator (main) + specialists via the `Agent` tool
 *   hooks                    → hop accounting, allowlist denial, trace
 *   Prompt Trace             → written BEFORE execution
 *   stream                   → main-agent text only, as `token` frames
 *
 * SINGLE VOICE: subagent output never becomes a `token` frame. Two independent mechanisms —
 * `forwardSubagentText: false` on the query, and a hard `parent_tool_use_id === null` filter
 * on everything this loop reads. `SDK_STREAM_MODE` (default `final`) additionally buffers the
 * coordinator's text so mid-turn reasoning cannot leak before the answer exists.
 *
 * TEMPORAL SAFETY: the model is handed `{ asOf }` and nothing else. `shiftDays` stays inside
 * the tool layer (see `tools.ts`).
 */

import type { StreamEvent } from "@shared/dto";
import {
  preflightSdkEngine,
  resolveBudgets,
  resolveThinkingConfig,
  resolveSdkStreamMode,
} from "../config";
import {
  chunk,
  toAgentTemporalView,
  type TurnEmit,
  type TurnEngine,
  type TurnInput,
} from "../engine";
import { buildAgentDefinitions, coordinatorPrompt } from "../agents";
import { createMarkerFilter, stripMarker } from "../needsInput";
import {
  buildHooks,
  createHopBudget,
  type EscalationOutcome,
  type HookContext,
  type ToolAttempt,
} from "../hooks";
import { createNovamartToolServer } from "../tools";
import {
  MCP_SERVER_NAME,
  allAllowedToolNames,
  isMoneyToolName,
  DELEGATION_TOOL_ALIASES,
  FORBIDDEN_BUILTIN_TOOLS,
} from "../toolRegistry";
import { createTracer, logPromptTrace } from "../trace";

function buildUserPrompt(input: TurnInput): string {
  const known: string[] = [];
  if (input.identity.orderId !== undefined) known.push(`order_id=${input.identity.orderId}`);
  if (input.identity.userId !== undefined) known.push(`user_id=${input.identity.userId}`);
  return [
    `conversation_id: ${input.conversationId}`,
    `known_identity: ${known.length > 0 ? known.join(", ") : "none supplied"}`,
    "",
    `customer_message: ${input.message}`,
  ].join("\n");
}

/** Text blocks from a main-thread assistant message. Subagent messages are filtered out. */
function mainAgentText(message: unknown): string {
  const msg = message as {
    parent_tool_use_id?: string | null;
    message?: { content?: Array<{ type?: string; text?: string }> };
  };
  if (msg.parent_tool_use_id != null) return "";
  const blocks = msg.message?.content ?? [];
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}

/** Live-mode text delta, main thread only. */
function mainAgentDelta(message: unknown): string {
  const msg = message as {
    parent_tool_use_id?: string | null;
    event?: { type?: string; delta?: { type?: string; text?: string } };
  };
  if (msg.parent_tool_use_id != null) return "";
  const event = msg.event;
  if (event?.type !== "content_block_delta") return "";
  if (event.delta?.type !== "text_delta") return "";
  return event.delta.text ?? "";
}

export const sdkEngine: TurnEngine = {
  id: "sdk",

  async runTurn(input: TurnInput, emit: TurnEmit): Promise<void> {
    const preflight = preflightSdkEngine();
    if (!preflight.ok) {
      // Documented, non-crashing failure. This is the ONLY thing a missing key produces.
      emit({ type: "error", code: preflight.code, message: preflight.message, retryable: false });
      emit({ type: "done", status: "escalated" });
      return;
    }

    const budgets = resolveBudgets();
    const streamMode = resolveSdkStreamMode();
    const tracer = createTracer(input.conversationId, "sdk");
    const temporal = toAgentTemporalView(input.temporal);
    const budget = createHopBudget(budgets.maxHops);
    const toolsTried: ToolAttempt[] = [];
    const citations: string[] = [];
    let escalationTicketId: string | undefined;

    // Trace frames are operator-only: gated here, once, rather than at each call site.
    const emitTrace = (event: StreamEvent): void => {
      if (input.trace) emit(event);
    };

    const toolServer = createNovamartToolServer({
      conversationId: input.conversationId,
      temporal,
      shiftDays: input.temporal.shiftDays,
      tracer,
      readRetries: budgets.toolReadRetries,
      signal: input.signal,
    });

    const thinking = resolveThinkingConfig(budgets);
    const agents = buildAgentDefinitions(temporal);
    const systemPrompt = coordinatorPrompt(temporal, budgets.maxHops);
    const userPrompt = buildUserPrompt(input);
    const allowedTools = allAllowedToolNames();

    logPromptTrace(tracer, {
      model: preflight.model,
      effort: budgets.effort,
      thinking:
        thinking.type === "adaptive"
          ? "adaptive"
          : `enabled(budgetTokens=${thinking.budgetTokens})`,
      budgets: {
        maxHops: budgets.maxHops,
        maxModelTurns: budgets.maxModelTurns,
        turnTimeoutMs: budgets.turnTimeoutMs,
        maxOutputTokens: budgets.maxOutputTokens,
        toolReadRetries: budgets.toolReadRetries,
      },
      systemPrompt,
      userPrompt,
      agents: Object.entries(agents).map(([id, def]) => ({ id, tools: def.tools ?? [] })),
      allowedTools,
      // Operator-only. Present in the log, absent from every prompt above.
      temporal: { ...input.temporal },
    });

    const escalation: EscalationOutcome = {};
    const hookCtx: HookContext = { tracer, budget, emitTrace, toolsTried, citations, escalation };
    const hooks = buildHooks(hookCtx);

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const abortController = new AbortController();
    const forwardAbort = (): void => abortController.abort();
    input.signal.addEventListener("abort", forwardAbort, { once: true });

    let buffered = "";
    let streamed = false;
    let sawResult = false;
    // Set when the coordinator marks its reply as a clarifying question (live mode sees the
    // marker mid-stream; final mode sees it in the buffered text).
    let needsInput = false;
    // Live mode only: releases coordinator text as it arrives while keeping a possible
    // partial control marker out of the customer's view.
    const markerFilter = createMarkerFilter();

    try {
      const run = query({
        prompt: userPrompt,
        options: {
          model: preflight.model,
          systemPrompt,
          agents,
          abortController,
          // Explicit budgets — nothing below is left to an SDK default (adapter Execution).
          maxTurns: budgets.maxModelTurns,
          // `maxThinkingTokens` is deprecated in the SDK and model-dependent; `thinking` +
          // `effort` are the supported controls. See config.ts resolveThinkingConfig.
          thinking,
          effort: budgets.effort,
          env: {
            ...process.env,
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(budgets.maxOutputTokens),
          } as Record<string, string>,
          // Least privilege: only MCP read tools + the delegation tool exist. No Bash, no
          // Write, no WebFetch, no filesystem.
          allowedTools: [...allowedTools, "Agent"],
          // Sourced from the registry, not a literal, so this list cannot drift from the
          // per-agent allowlists or the invariant test.
          disallowedTools: [...FORBIDDEN_BUILTIN_TOOLS],
          mcpServers: { [MCP_SERVER_NAME]: toolServer },
          hooks,
          // Layer 5 of the money-tool defence, independent of the PreToolUse hook. Also the
          // one place delegation is forced synchronous — see below.
          canUseTool: async (toolName, toolInput) => {
            if (isMoneyToolName(toolName)) {
              return {
                behavior: "deny" as const,
                message: "No money tool exists in this system.",
                interrupt: false,
              };
            }

            // SDK >= 0.3.x runs subagents in the BACKGROUND by default: the `Agent` tool
            // returns `{ status: "async_launched" }` immediately and the coordinator answers
            // without ever seeing the specialist's result. For a support crew that is a
            // grounding failure, not a performance choice — the coordinator would state
            // order facts that no tool ever returned, which is exactly what SAFETY_RULES
            // forbids. The prompt asks for synchronous delegation; this makes it structural,
            // because a prompt instruction is not a control.
            if ((DELEGATION_TOOL_ALIASES as readonly string[]).includes(toolName)) {
              return {
                behavior: "allow" as const,
                updatedInput: { ...toolInput, run_in_background: false },
              };
            }

            // `updatedInput` REPLACES the tool input, so it must be omitted rather than sent
            // as `{}` when there is nothing to change.
            return { behavior: "allow" as const };
          },
          // Single voice: specialist text never reaches this loop in the first place.
          forwardSubagentText: false,
          includePartialMessages: streamMode === "live",
          // No session reuse in Sprint 1 (SAD: in-memory session is acceptable).
          persistSession: false,
          cwd: process.cwd(),
        },
      });

      for await (const message of run) {
        if (input.signal.aborted) break;

        if (streamMode === "live" && (message as { type?: string }).type === "stream_event") {
          const delta = mainAgentDelta(message);
          if (delta.length > 0) {
            const releasable = markerFilter.push(delta);
            if (releasable.length > 0) {
              streamed = true;
              emit({ type: "token", text: releasable });
            }
          }
          continue;
        }

        if ((message as { type?: string }).type === "assistant") {
          const text = mainAgentText(message);
          if (text.length > 0 && streamMode === "final") buffered = text;
          continue;
        }

        if ((message as { type?: string }).type === "result") {
          // First result wins. A turn can surface more than one `result` message (seen in the
          // 2026-08-23 trace 86a9ba42: numTurns 2 then 1), and acting on the later one would
          // overwrite the real answer and double the `turn_result` trace line.
          if (sawResult) continue;
          sawResult = true;
          const result = message as {
            subtype?: string;
            result?: string;
            num_turns?: number;
            total_cost_usd?: number;
            usage?: unknown;
          };
          tracer.log({
            event: "turn_result",
            subtype: result.subtype,
            numTurns: result.num_turns,
            costUsd: result.total_cost_usd,
            usage: result.usage,
            hops: budget.hops,
            path: budget.path,
          });
          if (result.subtype === "success" && typeof result.result === "string") {
            buffered = streamMode === "final" ? result.result : buffered;
          } else if (result.subtype !== "success") {
            emit({
              type: "error",
              code: "turn_failed",
              message: "I couldn't finish that. Please try again, or ask for a human.",
              retryable: true,
            });
            emit({ type: "done", status: "escalated" });
            return;
          }
        }
      }

      if (input.signal.aborted) {
        emit({
          type: "error",
          code: "turn_aborted",
          message: "That took too long, so I stopped. Please try again, or ask for a human.",
          retryable: true,
        });
        emit({ type: "done", status: "escalated" });
        return;
      }

      if (streamMode === "final") {
        const stripped = stripMarker(buffered);
        if (stripped.found) needsInput = true;
        buffered = stripped.text.trimEnd();
        if (buffered.length > 0) {
          for (const part of chunk(buffered)) emit({ type: "token", text: part });
          streamed = true;
        }
      } else {
        // Live mode: whatever is still held back cannot be a marker now that the stream is
        // done, so it is real customer text and must not be swallowed.
        const rest = markerFilter.flush();
        if (rest.length > 0) {
          streamed = true;
          emit({ type: "token", text: rest });
        }
        if (markerFilter.found()) needsInput = true;
      }

      if (!streamed || !sawResult) {
        emit({
          type: "error",
          code: "empty_turn",
          message: "I didn't get an answer together. Please try again, or ask for a human.",
          retryable: true,
        });
        emit({ type: "done", status: "escalated" });
        return;
      }

      if (citations.length > 0) emit({ type: "citation", ids: [...new Set(citations)] });

      escalationTicketId = hookCtx.escalation.ticketStubId;
      if (escalationTicketId !== undefined) {
        emit({
          type: "escalation",
          ticketStubId: escalationTicketId,
          reasonCode: hookCtx.escalation.reasonCode ?? "restricted_action",
        });
        emit({ type: "done", status: "escalated" });
        return;
      }

      // Structured, not inferred: the coordinator declares a clarifying question with the
      // control marker (stripped above). The hop check stays as a guard — a turn that
      // delegated has by definition done work, so it is not merely awaiting the customer.
      const askedForMore = needsInput && budget.hops === 0;
      emit({ type: "done", status: askedForMore ? "needs_input" : "resolved" });
    } catch (err) {
      console.error("sdk engine turn failed", err);
      tracer.log({ event: "turn_error", error: String(err) });
      emit({
        type: "error",
        code: "turn_failed",
        message: "Something went wrong on our side. Please try again.",
        retryable: true,
      });
      emit({ type: "done", status: "escalated" });
    } finally {
      input.signal.removeEventListener("abort", forwardAbort);
      await tracer.flush();
    }
  },
};
