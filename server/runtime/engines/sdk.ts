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
import { isUnaidedAnswer } from "../groundingGuard";
import { createMarkerFilter, stripMarker } from "../needsInput";
import {
  buildHooks,
  createHopBudget,
  type EscalationOutcome,
  type HookContext,
  type ToolAttempt,
} from "../hooks";
import { createTicketStub, formatHandoffSummary } from "../escalation";
import { categoryForIntent } from "../escalationContext";
import { createNovamartToolServer } from "../tools";
import {
  MCP_SERVER_NAME,
  allAllowedToolNames,
  isMoneyToolName,
  DELEGATION_TOOL_ALIASES,
  FORBIDDEN_BUILTIN_TOOLS,
} from "../toolRegistry";
import { createTracer, logPromptTrace } from "../trace";

/**
 * The turn prompt: identity, what was already said, and the question.
 *
 * History is passed as TEXT rather than through SDK session resume (SAD §2 "Sessions /
 * resume"). Two reasons. It keeps the turn a pure function of what this process stored — the
 * transcript in `sessions.sqlite` IS the memory, so an operator reading the database sees
 * exactly what the model saw. And it keeps the SessionStore the single source of truth rather
 * than splitting conversation state between our SQLite file and the SDK's own session state,
 * where a divergence would be invisible until it produced a wrong answer.
 *
 * Facts are NOT carried forward — only what was said. Tool results are re-read every turn, so
 * an order status quoted twenty minutes ago is never restated as if it were current.
 */
function buildUserPrompt(input: TurnInput): string {
  const known: string[] = [];
  if (input.identity.orderId !== undefined) known.push(`order_id=${input.identity.orderId}`);
  if (input.identity.userId !== undefined) known.push(`user_id=${input.identity.userId}`);

  const lines = [
    `conversation_id: ${input.conversationId}`,
    `known_identity: ${known.length > 0 ? known.join(", ") : "none supplied"}`,
  ];

  if (input.history.length > 0) {
    lines.push(
      "",
      "conversation_so_far (oldest first — context only; re-read any fact you need to state):",
      ...input.history.map(
        (entry) => `  ${entry.role === "user" ? "Customer" : "You"}: ${entry.content}`,
      ),
    );
  }

  lines.push("", `customer_message: ${input.message}`);
  return lines.join("\n");
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

  async runTurn(input: TurnInput, rawEmit: TurnEmit): Promise<void> {
    const preflight = preflightSdkEngine();
    if (!preflight.ok) {
      // Documented, non-crashing failure. This is the ONLY thing a missing key produces.
      rawEmit({ type: "error", code: preflight.code, message: preflight.message, retryable: false });
      rawEmit({ type: "done", status: "escalated" });
      return;
    }

    const budgets = resolveBudgets();
    const streamMode = resolveSdkStreamMode();
    const tracer = createTracer(input.conversationId, "sdk");
    /*
     * Turn latency was previously only derivable by pairing `prompt_trace` with `turn_result`,
     * which breaks on exactly the turns worth measuring: one that throws never writes a
     * `turn_result` to pair with. Recorded on both terminal paths instead.
     */
    const turnStartedAt = Date.now();
    /*
     * Time to first token — the metric that says what a customer actually FEELS.
     *
     * Turn duration alone cannot distinguish a turn that printed steadily for 16s from one
     * that showed nothing for 16s and then dumped an answer, and those are different products.
     * It also makes the effect of SDK_STREAM_MODE measurable rather than assumed: under `final`
     * (the default) ttft converges on the full turn duration, because nothing reaches the wire
     * until the whole reply is buffered.
     */
    let firstTokenAt: number | null = null;
    const emit: TurnEmit = (event) => {
      if (firstTokenAt === null && event.type === "token") firstTokenAt = Date.now();
      rawEmit(event);
    };
    const temporal = toAgentTemporalView(input.temporal);
    const budget = createHopBudget(budgets.maxHops);
    const toolsTried: ToolAttempt[] = [];
    /** Data tools this turn attempted — see HookContext.toolAttempts (INT-03). */
    const toolAttempts: string[] = [];
    const citations: string[] = [];
    let escalationTicketId: string | undefined;

    // Trace frames are operator-only: gated here, once, rather than at each call site.
    const emitTrace = (event: StreamEvent): void => {
      if (input.trace) emit(event);
    };

    const toolServer = createNovamartToolServer({
      conversationId: input.conversationId,
      appContext: input.appContext,
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
    const hookCtx: HookContext = {
      tracer,
      budget,
      emitTrace,
      toolsTried,
      toolAttempts,
      citations,
      escalation,
    };
    const hooks = buildHooks(hookCtx);

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const abortController = new AbortController();
    const forwardAbort = (): void => abortController.abort();
    input.signal.addEventListener("abort", forwardAbort, { once: true });

    let buffered = "";
    /** Live mode: a completed assistant message is waiting to be separated from the next. */
    let pendingParagraphBreak = false;
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
              // A coordinator that speaks before delegating and again after produces TWO
              // assistant messages, and their deltas used to run together mid-sentence:
              // "...connect you with a human agent for that.I'm not able to process refunds".
              // The break belongs here rather than in the UI — `token` frames are the
              // customer-visible text, and the deterministic engine emits its own breaks.
              if (pendingParagraphBreak) {
                emit({ type: "token", text: "\n\n" });
                pendingParagraphBreak = false;
              }
              streamed = true;
              emit({ type: "token", text: releasable });
            }
          }
          continue;
        }

        if ((message as { type?: string }).type === "assistant") {
          const text = mainAgentText(message);
          if (text.length > 0 && streamMode === "final") buffered = text;
          // The assistant message arrives AFTER its own deltas, so this marks a boundary the
          // next delta must be separated from — not a break to emit now.
          if (streamMode === "live" && streamed && text.length > 0) pendingParagraphBreak = true;
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
            durationMs: Date.now() - turnStartedAt,
            streamMode,
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

      /**
       * ADR-08 says a spent hop budget FORCES escalation. Until now nothing forced it: the
       * PreToolUse hook denied the handoff and told the coordinator to escalate, and the
       * coordinator was free to ignore that and write something else. Observed live at
       * `maxHops=1` — the denial fired, and the customer was told "let me get that sorted
       * for you now, and I'll follow up shortly", which nobody was going to do.
       *
       * So the runtime builds the package itself, exactly as the deterministic engine does
       * for money intent (ADR-16). `tools_tried` and `citations` come from the hook ledger,
       * so the ticket carries what actually happened rather than what a model recalls.
       */
      /**
       * The second forced exit: a turn that consulted nobody. See `groundingGuard.ts` — the
       * coordinator is told never to answer from its own knowledge, and mostly does not, but
       * "mostly" is not a guarantee and this is the claim the whole architecture rests on.
       */
      const unaided = isUnaidedAnswer(input.message, {
        hops: budget.hops,
        escalated: false,
        needsInput,
      });

      if (budget.exhausted || unaided) {
        const forcedReason = budget.exhausted ? "repeat_failure" : "ungrounded";
        const forced = createTicketStub(
          {
            conversationId: input.conversationId,
            intent: "other",
            entities: {
              // A forced escalation must not carry less context than a voluntary one
              // (AC-TICKET-01).
              ...input.appContext,
              ...(input.identity.orderId !== undefined ? { order_id: input.identity.orderId } : {}),
              ...(input.identity.userId !== undefined ? { user_id: input.identity.userId } : {}),
            },
            urgency: "medium",
            transcript_summary: budget.exhausted
              ? `The assistant reached its ${budget.maxHops}-handoff limit for this turn ` +
                `before finishing. Path: ${budget.path.join(" → ") || "none"}. The customer's ` +
                "question still needs an answer."
              : "The assistant replied without consulting a specialist, so the answer was not " +
                "grounded in NovaMart data or policy. The customer's question needs a human.",
            tools_tried: [...toolsTried],
            citations: [...new Set(citations)],
            reason_code: forcedReason,
            // AC-ESC-05: intent is unresolved on a forced exit, and `other` is what the map
            // returns for that — stated through the map rather than hard-coded beside it.
            suggested_category: categoryForIntent("other"),
          },
          { asOf: input.temporal.asOf },
        );

        if (forced.ok) {
          tracer.log({
            event: "forced_escalation",
            reason: budget.exhausted ? "hop_budget_exhausted" : "unaided_answer",
            ticket_stub_id: forced.ticket_stub_id,
            hops: budget.hops,
            maxHops: budget.maxHops,
          });
          // The coordinator's own text has already streamed and cannot be unsaid, so this is
          // appended rather than substituted: whatever it promised, a ticket now exists.
          for (const part of chunk(`\n\n${formatHandoffSummary(forced.stub)}`)) {
            emit({ type: "token", text: part });
          }
          emit({
            type: "escalation",
            ticketStubId: forced.ticket_stub_id,
            reasonCode: forcedReason,
          });
          emit({ type: "done", status: "escalated" });
          return;
        }

        // Package rejected: say so rather than reporting a handoff that did not happen.
        tracer.log({ event: "forced_escalation_failed", errors: forced.errors });
      }

      /**
       * Terminal status, decided on TWO signals: what the coordinator declared, and what the
       * tools actually returned.
       *
       * 1. The control marker (stripped above) — the coordinator saying "I am waiting on the
       *    customer". Structured, not inferred from a question mark.
       * 2. INT-03: every tool call this turn failed.
       *
       * The second exists because the first is model-emitted and therefore not a guarantee.
       * Order 999999999 produced "Could you double-check the order number?" with
       * `done{resolved}` and, once CSAT landed, a satisfaction survey underneath an
       * unanswered question — while the deterministic engine returned `needs_input` for the
       * same input, which ADR-16/ADR-18 make a contract violation rather than a divergence.
       *
       * The runtime signal is precise: a specialist ran, every tool it called came back
       * `ok: false`, and nothing escalated. The turn consulted the data and the data had
       * nothing — so it is waiting on the customer, whatever the reply happened to say.
       *
       * `ok: true` with an empty result stays `resolved`, deliberately. "You have never had a
       * Plus membership" is a complete answer built from a successful lookup, and reporting it
       * as `needs_input` would ask the customer to supply something they have already given.
       * That distinction is exactly why this keys on the tool ledger rather than on citations.
       */
      /*
       * Attempts vs successes, not the outcome ledger alone.
       *
       * Two things had to be learned the hard way here. The delegation tool is excluded,
       * because `Agent` succeeding means a specialist RAN, not that the data had anything —
       * counting it made "every tool failed" unreachable. And a tool that returns an error
       * never reaches PostToolUse at all, so the failing get_order in the INT-03 case left a
       * `tool_call` with no matching `tool_result`: invisible in `toolsTried`, which is why
       * that ledger alone could not see the very case this rule exists for.
       */
      const isDataTool = (tool: string): boolean =>
        !(DELEGATION_TOOL_ALIASES as readonly string[]).includes(tool);
      const dataAttempts = toolAttempts.filter(isDataTool);
      const dataSuccesses = toolsTried.filter((a) => isDataTool(a.tool) && a.ok);
      const everyToolFailed = dataAttempts.length > 0 && dataSuccesses.length === 0;
      const askedForMore = (needsInput && budget.hops === 0) || everyToolFailed;

      if (everyToolFailed && !needsInput) {
        tracer.log({
          event: "needs_input_inferred",
          reason: "all_tool_calls_failed",
          tools: [...dataAttempts],
          hops: budget.hops,
        });
      }

      emit({ type: "done", status: askedForMore ? "needs_input" : "resolved" });
    } catch (err) {
      console.error("sdk engine turn failed", err);
      tracer.log({
        event: "turn_error",
        error: String(err),
        durationMs: Date.now() - turnStartedAt,
        streamMode,
        hops: budget.hops,
        path: budget.path,
      });
      emit({
        type: "error",
        code: "turn_failed",
        message: "Something went wrong on our side. Please try again.",
        retryable: true,
      });
      emit({ type: "done", status: "escalated" });
    } finally {
      /*
       * Logged HERE, not on turn_result, because under SDK_STREAM_MODE=final the buffered reply
       * is emitted AFTER the SDK result arrives — so a ttft read at turn_result time is always
       * null in exactly the mode whose perceived latency is worst. By the finally block every
       * frame this turn will ever send has been sent.
       */
      tracer.log({
        event: "turn_timing",
        streamMode,
        ttftMs: firstTokenAt === null ? null : firstTokenAt - turnStartedAt,
        totalMs: Date.now() - turnStartedAt,
      });
      input.signal.removeEventListener("abort", forwardAbort);
      await tracer.flush();
    }
  },
};
