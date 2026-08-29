/**
 * Prompt Trace + lifecycle trace log (adapter Logging; SAD §2 "Prompt Trace → persist under
 * project-context/2.build/logs/ (redacted)", F-TRACE-01).
 *
 * One JSONL file per conversation. Two guarantees:
 *   1. Nothing here can fail a turn. Every write is best-effort and swallowed — an operator
 *      diagnostic is not worth a customer-visible 500.
 *   2. Secrets never land on disk. `redact()` runs over every record, not just the ones we
 *      remember to sanitise at the call site.
 *
 * NOTE for @devops.eng: `.gitignore:19` ignores `project-context/2.build/logs/`, so the
 * directory does not survive a fresh clone. This module creates it on demand (recursive
 * mkdir), which is why no `.gitkeep` un-ignore is needed. Flagged rather than fixed.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "project-context", "2.build", "logs");

/** Keys whose values are replaced wholesale, regardless of shape. */
const SECRET_KEY_PATTERN = /(api[-_]?key|secret|token|password|authorization|credential)/i;

/** Value-level catch-all for anything that looks like a provider key. */
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;

const REDACTED = "[REDACTED]";
const MAX_STRING = 2_000;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (typeof value === "string") {
    const truncated =
      value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
    return truncated.replace(SECRET_VALUE_PATTERN, REDACTED);
  }
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

export type TraceRecord = {
  event: string;
  [key: string]: unknown;
};

export type Tracer = {
  readonly conversationId: string;
  /** Fire-and-forget append. Never throws, never awaited on the hot path. */
  log(record: TraceRecord): void;
  /** Await outstanding writes before the turn closes. Never throws. */
  flush(): Promise<void>;
};

export function createTracer(conversationId: string, engineId: string): Tracer {
  const file = path.join(LOG_DIR, `${sanitiseId(conversationId)}.jsonl`);
  let queue: Promise<void> = Promise.resolve();

  const log = (record: TraceRecord): void => {
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      conversationId,
      engine: engineId,
      ...(redact(record) as Record<string, unknown>),
    })}\n`;
    queue = queue
      .then(async () => {
        await mkdir(LOG_DIR, { recursive: true });
        await appendFile(file, line, "utf8");
      })
      .catch((err: unknown) => {
        console.warn("trace write failed (non-fatal)", err);
      });
  };

  return {
    conversationId,
    log,
    flush: async () => {
      try {
        await queue;
      } catch {
        /* already handled above */
      }
    },
  };
}

/**
 * Path-safe conversation id. This is the ONLY thing standing between a URL path segment and
 * `path.join`, so it strips every character that could climb out of the log directory —
 * `..`, slashes, and anything else non-alphanumeric — rather than trying to detect traversal.
 */
export function sanitiseId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "unknown";
}

/** Where per-conversation trace files live. Read by the operator trace endpoint. */
export function traceLogPath(conversationId: string): string {
  return path.join(LOG_DIR, `${sanitiseId(conversationId)}.jsonl`);
}

/**
 * Prompt Trace — captured BEFORE execution (adapter Logging: "Capture Prompt Trace prior to
 * execution"). Records the rendered prompt surface and every resolved runtime control, so a
 * run can be reproduced from the log alone.
 */
export type PromptTrace = {
  model: string;
  /**
   * Resolved thinking controls. There is deliberately no `temperature`: it was removed from
   * the Messages API on current models and the SDK exposes no such option, so recording one
   * would put a value in the Audit that never reached the model.
   */
  effort: string;
  thinking: string;
  budgets: Record<string, number>;
  systemPrompt: string;
  userPrompt: string;
  agents: Array<{ id: string; tools: readonly string[] }>;
  allowedTools: readonly string[];
  /** Operator-only temporal meta. Never given to an agent — see `engine.ts`. */
  temporal: Record<string, unknown>;
};

export function logPromptTrace(tracer: Tracer, trace: PromptTrace): void {
  tracer.log({ event: "prompt_trace", ...trace });
}
