/**
 * Runtime configuration and execution budgets (SAD §2 "claude-agent-sdk runtime-conditional
 * configuration", adapter Execution: "Set explicit per-task turn and token budgets; do not
 * rely on implicit defaults").
 *
 * Every budget below is resolved to a concrete number here. Nothing downstream is allowed to
 * fall back to an SDK default — if a value is missing or unparseable we use the SAD default,
 * and the resolved values are echoed into the Prompt Trace so a run is reproducible.
 */

/** Which turn engine handles a request. Default is deliberately the keyless one. */
export type EngineId = "deterministic" | "sdk";

export const DEFAULT_ENGINE: EngineId = "deterministic";

/**
 * `CHAT_ENGINE=deterministic|sdk`. Unset, empty, or unrecognised ⇒ deterministic.
 * An unrecognised value is NOT an error: a typo must never take the demo offline.
 */
export function resolveEngineId(): EngineId {
  const raw = process.env.CHAT_ENGINE?.trim().toLowerCase();
  return raw === "sdk" ? "sdk" : DEFAULT_ENGINE;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/** Same as `intFromEnv`, but "unset" is meaningful and stays `undefined`. */
function optionalIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

/** Thinking depth, per the SDK `effort` option. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORT_LEVELS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

function effortFromEnv(name: string, fallback: EffortLevel): EffortLevel {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw !== undefined && EFFORT_LEVELS.includes(raw) ? (raw as EffortLevel) : fallback;
}

export type TurnBudgets = {
  /** Agent transfers per turn (SAD "Hop accounting (normative)"; a tool call is not a hop). */
  maxHops: number;
  /** Model turns inside the SDK loop. Distinct from hops; caps runaway tool ping-pong. */
  maxModelTurns: number;
  /** Wall clock for the whole turn (SAD: turnTimeoutMs=60000). */
  turnTimeoutMs: number;
  /** Output token ceiling per turn. Overrun ⇒ halt + Diagnostic, never a silent truncation. */
  maxOutputTokens: number;
  /**
   * Thinking depth. Replaces the SAD's "low temperature" determinism lever, which no longer
   * exists: `temperature` was removed from the Messages API on Opus 5 / Sonnet 5 / Opus 4.7+
   * (sending it is a 400) and the SDK's `Options` exposes no temperature knob at all.
   * `effort` is the supported control, so determinism is expressed here instead.
   */
  effort: EffortLevel;
  /**
   * Fixed thinking-token budget, for OLDER models only (Haiku 4.5, Sonnet 4.5 …) which take
   * `thinking: {type:"enabled", budgetTokens}`. Leave unset on Opus 4.6+ / Sonnet 4.6+ /
   * Opus 5 / Sonnet 5, where adaptive thinking is correct and a fixed budget is rejected.
   * Unset ⇒ adaptive. See `resolveThinkingConfig`.
   */
  thinkingBudgetTokens: number | undefined;
  /** Retries for an idempotent repository read (SAD: 1). Validation errors are not retried. */
  toolReadRetries: number;
};

/** SAD-normative defaults. Env vars override; nothing is left to the SDK to decide. */
export function resolveBudgets(): TurnBudgets {
  return {
    maxHops: intFromEnv("MAX_HOPS", 4),
    maxModelTurns: intFromEnv("MAX_MODEL_TURNS", 12),
    // 120s, not 60s: delegation is forced synchronous (see `sdk.ts` canUseTool), and a
    // measured two-hop turn (order lookup then escalation) runs ~50s wall clock. The old
    // 60s budget aborted those turns after the work had already been done.
    turnTimeoutMs: intFromEnv("TURN_TIMEOUT_MS", 120_000),
    maxOutputTokens: intFromEnv("MAX_OUTPUT_TOKENS", 4_096),
    effort: effortFromEnv("MODEL_EFFORT", "low"),
    thinkingBudgetTokens: optionalIntFromEnv("MAX_THINKING_TOKENS"),
    toolReadRetries: intFromEnv("TOOL_READ_RETRIES", 1),
  };
}

/**
 * The SDK `thinking` option. `maxThinkingTokens` is deprecated in the SDK and its meaning is
 * model-dependent — on Opus 4.6 any non-zero value is treated as a plain on/off switch, so the
 * old `MAX_THINKING_TOKENS=1024` did NOT cap thinking at 1024 tokens as its comment claimed.
 * Adaptive is correct on current models; a fixed budget is for older ones only.
 */
export function resolveThinkingConfig(
  budgets: TurnBudgets,
): { type: "adaptive" } | { type: "enabled"; budgetTokens: number } {
  return budgets.thinkingBudgetTokens === undefined
    ? { type: "adaptive" }
    : { type: "enabled", budgetTokens: budgets.thinkingBudgetTokens };
}

/**
 * How main-agent text becomes `token` events (SAD §2 "Customer sees one assistant voice").
 *   `final` — buffer the coordinator's text and emit it once the turn resolves. Guarantees
 *             no mid-turn reasoning leaks into the customer stream. DEFAULT.
 *   `live`  — stream main-agent text deltas as they arrive. Lower TTFT, but only safe once
 *             the coordinator is verified to speak exactly once, at the end.
 * Subagent text is suppressed in BOTH modes, structurally (see `engines/sdk.ts`).
 */
export type SdkStreamMode = "final" | "live";

export function resolveSdkStreamMode(): SdkStreamMode {
  return process.env.SDK_STREAM_MODE?.trim().toLowerCase() === "live" ? "live" : "final";
}

export type SdkPreflight =
  | { ok: true; model: string }
  | { ok: false; code: string; message: string };

/**
 * Fail-fast check for the sdk engine (adapter Failure Policy: "Halt with Diagnostic when
 * runtime prerequisites fail"). Called BEFORE the SDK is imported, so a missing key costs a
 * clean 1-frame error instead of a module-load crash.
 *
 * `MODEL_ID` is required rather than defaulted on purpose: a silently-chosen model makes the
 * Audit line a lie and makes evals irreproducible.
 */
export function preflightSdkEngine(): SdkPreflight {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (key === undefined || key.length === 0) {
    return {
      ok: false,
      code: "sdk_engine_unconfigured",
      message:
        "The sdk engine needs ANTHROPIC_API_KEY. Set it in .env.local, or unset CHAT_ENGINE " +
        "to use the deterministic engine.",
    };
  }
  const model = process.env.MODEL_ID?.trim();
  if (model === undefined || model.length === 0) {
    return {
      ok: false,
      code: "sdk_engine_unconfigured",
      message:
        "The sdk engine needs MODEL_ID. It is required, not defaulted, so the resolved model " +
        "is always recorded in the run trace.",
    };
  }
  return { ok: true, model };
}
