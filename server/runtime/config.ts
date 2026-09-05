/**
 * Runtime configuration and execution budgets (SAD §2 "claude-agent-sdk runtime-conditional
 * configuration", adapter Execution: "Set explicit per-task turn and token budgets; do not
 * rely on implicit defaults").
 *
 * Every budget below is resolved to a concrete number here. Nothing downstream is allowed to
 * fall back to an SDK default — if a value is missing or unparseable we use the SAD default,
 * and the resolved values are echoed into the Prompt Trace so a run is reproducible.
 */

import {
  DEFAULT_HOLIDAY_API_BASE_URL,
  DEFAULT_HOLIDAY_TIMEOUT_MS,
} from "@/server/data/holidays";

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

/**
 * Integer budget from the environment.
 *
 * UNSET falls back to the default. SET-BUT-INVALID throws — those are different situations and
 * used to have the same outcome.
 *
 * DEF-07 (qa.md, 2026-08-29): QA set `MAX_HOPS=0` to force hop exhaustion and the trace
 * recorded `maxHops=4`. The old guard was `parsed > 0`, so `0`, any negative, and any typo
 * (`MAX_HOPS=1o`) all became the default silently. That is the failure this project already
 * refuses elsewhere — `MODEL_ID` is required rather than defaulted because "a silently chosen
 * model makes the Audit line a lie" — and it produced exactly that lie: the operator believes
 * 2, the runtime uses 4, and the Audit records 4.
 *
 * `min` exists because `0` is meaningful for some of these knobs and not others.
 * `MAX_HOPS=0` means "never delegate", a legitimate kill switch; `TOOL_READ_RETRIES=0` means
 * "do not retry"; a `TURN_TIMEOUT_MS` of 0 means nothing useful. `RATE_LIMIT_PER_MIN` already
 * treated `0` as "disabled", so before this the codebase disagreed with itself about what an
 * explicit zero meant.
 */
function intFromEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min) {
    throw new Error(
      `${name}="${raw}" is not a valid setting: expected an integer >= ${min}. ` +
        "Fix it or unset it to use the default — a budget that was asked for and silently " +
        "ignored is worse than one that was never set.",
    );
  }
  return parsed;
}

/** Same as `intFromEnv`, but "unset" is meaningful and stays `undefined`. */
function optionalIntFromEnv(name: string, min = 1): number | undefined {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min) {
    throw new Error(
      `${name}="${raw}" is not a valid setting: expected an integer >= ${min}, or unset.`,
    );
  }
  return parsed;
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
  /** Wall clock for the whole turn (SAD §2, ADR-19: turnTimeoutMs=120000). */
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
    // 0 is legal here: "never delegate" is a real operator choice (DEF-07).
    maxHops: intFromEnv("MAX_HOPS", 4, 0),
    maxModelTurns: intFromEnv("MAX_MODEL_TURNS", 12),
    // 120s, not 60s: delegation is forced synchronous (see `sdk.ts` canUseTool), and a
    // measured two-hop turn (order lookup then escalation) runs ~50s wall clock. The old
    // 60s budget aborted those turns after the work had already been done.
    turnTimeoutMs: intFromEnv("TURN_TIMEOUT_MS", 120_000),
    maxOutputTokens: intFromEnv("MAX_OUTPUT_TOKENS", 4_096),
    effort: effortFromEnv("MODEL_EFFORT", "low"),
    thinkingBudgetTokens: optionalIntFromEnv("MAX_THINKING_TOKENS"),
    // 0 is legal here too: "do not retry" is a real operator choice (DEF-07).
    toolReadRetries: intFromEnv("TOOL_READ_RETRIES", 1, 0),
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

/**
 * Whether this deployment serves the demo surface — crew strip, 23-scenario picker, handoff
 * packet. Resolved HERE, on the server, and reported through `/api/health`, because the browser
 * cannot answer it: `NEXT_PUBLIC_DEMO_MODE` is inlined by `next build`, so in a built image it
 * is frozen at whatever the build machine had and no compose file or platform variable can move
 * it (DEF-17). `DEMO_MODE` is an ordinary server variable, so a restart is enough.
 *
 * Strictly `"1"`, like every other switch here: a variable set to `false` or `no` must not read
 * as truthy, because the failure direction is publishing an operator surface by accident.
 */
export function demoModeEnabled(): boolean {
  return process.env.DEMO_MODE?.trim() === "1";
}

/**
 * Holiday-calendar integration settings (`server/data/holidays.ts`). The base URL is an
 * OPERATOR setting, never model- or customer-supplied — that is what keeps the one outbound
 * host in this system out of reach of a prompt injection.
 */
export type HolidayApiConfig = { baseUrl: string; timeoutMs: number };

export function resolveHolidayApiConfig(): HolidayApiConfig {
  const raw = process.env.HOLIDAY_API_BASE_URL?.trim();
  return {
    baseUrl: raw !== undefined && raw.length > 0 ? raw : DEFAULT_HOLIDAY_API_BASE_URL,
    timeoutMs: intFromEnv("HOLIDAY_TIMEOUT_MS", DEFAULT_HOLIDAY_TIMEOUT_MS),
  };
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
