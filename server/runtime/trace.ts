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

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "project-context", "2.build", "logs");

/** Keys whose values are replaced wholesale, regardless of shape. */
const SECRET_KEY_PATTERN = /(api[-_]?key|secret|token|password|authorization|credential)/i;

/** Value-level catch-all for anything that looks like a provider key. */
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;

/**
 * Token USAGE counts, exempted from the secret-key rule above.
 *
 * `SECRET_KEY_PATTERN` matches the substring "token", which also matches `input_tokens`,
 * `output_tokens` and every `cache_*_input_tokens` field the SDK reports. The whole usage
 * block was therefore written to disk as `[REDACTED]`: `costUsd` survived, so a turn's price
 * was visible but never its cause — a cache miss and a ballooned prompt looked identical.
 *
 * The exemption is two-part on purpose. The key has to read as a count — PLURAL `tokens`, in
 * either convention this codebase uses: `input_tokens` from the SDK, `maxOutputTokens` from our
 * own budgets — AND the value must not be a string. Singular is left alone, so `access_token`
 * and `auth_token` still redact. The non-string half is what actually carries the safety:
 * credentials are strings, usage is numbers and the objects holding them, so a secret
 * mis-named `tokens` redacts anyway.
 */
const TOKEN_COUNT_KEY_SNAKE = /(^|_)tokens(_|$)/i;
const TOKEN_COUNT_KEY_CAMEL = /[a-z]Tokens($|[A-Z_])/;

function isUsageCount(key: string, value: unknown): boolean {
  if (typeof value === "string") return false;
  return TOKEN_COUNT_KEY_SNAKE.test(key) || TOKEN_COUNT_KEY_CAMEL.test(key);
}

/*
 * ---------------------------------------------------------------------------------------------
 * PII scrubbing (SEC-03).
 *
 * The secret rules above target CREDENTIALS. Customer content is not a secret by that definition
 * and was written verbatim by design, because the file exists so an operator can reconstruct a
 * turn — `prompt_trace.userPrompt` carries `conversation_so_far`, so the log holds the
 * customer's own words.
 *
 * Wholesale redaction of customer text would close the finding by destroying the artifact's
 * only purpose. So this scrubs the CONTACT DETAILS a person might type into a support chat and
 * leaves the sentence around them intact: "email me at [EMAIL] about order 46101" still debugs.
 *
 * What is deliberately NOT scrubbed: order ids and user ids. They are pseudonymous keys into a
 * fictional dataset, they are the join key for every trace, and removing them would make the
 * log unreadable while protecting nobody. That trade is the finding's calibration, not an
 * oversight — against real customer data, security.md already says SEC-03 rises to High, and
 * this control is a floor rather than a substitute for that reassessment.
 */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * 10+ digit runs with common separators. The 10-digit floor is what keeps this off the data the
 * log is FOR: order ids in this dataset are at most 5 digits and user ids at most 5, so neither
 * can trip it, and a bare `$175.05` has nowhere near enough digits.
 */
const PHONE_PATTERN = /(?<![\d.])(?:\+?\d[\d\s().-]{8,}\d)(?!\d)/g;

/**
 * 13–19 digit runs that pass Luhn. Luhn rather than length alone so a long ordinary number — an
 * id, a timestamp, a token count rendered into a sentence — is not silently mangled.
 *
 * The trailing guard is `(?!\d)` and NOT `(?![\d.])`: a card at the end of a sentence is
 * followed by a full stop, and excluding `.` made the whole match fail there. The observed
 * result was worse than no rule — the card fell through to the phone pattern, which matched a
 * prefix and left the last group in the clear as `[PHONE] 4242`. The leading lookbehind still
 * prevents starting mid-decimal, and the 13-digit floor keeps this away from money amounts.
 */
const CARD_CANDIDATE = /(?<![\d.])(?:\d[ -]?){13,19}(?!\d)/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function scrubPii(text: string): string {
  return text
    .replace(EMAIL_PATTERN, "[EMAIL]")
    .replace(CARD_CANDIDATE, (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) return match;
      return passesLuhn(digits) ? "[CARD]" : match;
    })
    .replace(PHONE_PATTERN, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15 ? "[PHONE]" : match;
    });
}

const REDACTED = "[REDACTED]";
const MAX_STRING = 2_000;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (typeof value === "string") {
    const truncated =
      value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
    return scrubPii(truncated.replace(SECRET_VALUE_PATTERN, REDACTED));
  }
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const secretKey = SECRET_KEY_PATTERN.test(key) && !isUsageCount(key, val);
    out[key] = secretKey ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

export type TraceRecord = {
  event: string;
  [key: string]: unknown;
};

export type Tracer = {
  readonly conversationId: string;
  /**
   * Correlation id for THIS turn, stamped on every record the turn writes.
   *
   * `conversationId` identifies the whole thread, which is one level too coarse to correlate
   * with: a conversation holds many turns, and `agentRunId` only identifies one agent
   * invocation inside a turn. Without this, a reader has to pair `prompt_trace` with the next
   * `turn_result` positionally — which is what the observability script did, and which silently
   * mis-pairs the moment two turns of one conversation overlap. This is the key the SSE `done`
   * frame, the operator endpoint and the JSONL all agree on.
   */
  readonly turnId: string;
  /** Fire-and-forget append. Never throws, never awaited on the hot path. */
  log(record: TraceRecord): void;
  /** Await outstanding writes before the turn closes. Never throws. */
  flush(): Promise<void>;
};

/*
 * ---------------------------------------------------------------------------------------------
 * Retention (SEC-03).
 *
 * The finding's first property is "no retention limit — files accumulate indefinitely", and a
 * retention window that exists only in a runbook is a plan, not a control. This enforces it.
 *
 * Pruning is EXPLICIT — `scripts/prune-traces.mjs`, run by hand or from cron. It is deliberately
 * not a side effect of `createTracer`.
 *
 * The first version of this did prune lazily on the first tracer of a process, and that cost
 * real data: `trace.test.ts` constructs a tracer, so `npm test` swept the developer's actual log
 * directory and destroyed 120 files of accumulated history, including the only recorded
 * failures in the project (the 2026-08-23 DEF-01 turns). Writing a log file is not a licence to
 * delete other ones, and a destructive operation reachable from a unit test is a design error
 * however carefully the window is chosen. Deletion now happens only where someone asked for it.
 */
const RETENTION_DAYS_DEFAULT = 7;

export function resolveRetentionDays(): number {
  const raw = process.env.TRACE_RETENTION_DAYS?.trim();
  if (raw === undefined || raw === "") return RETENTION_DAYS_DEFAULT;
  const parsed = Number(raw);
  // 0 is legal and means "keep nothing older than today" (DEF-07's lesson: an explicit 0 is a
  // real operator choice). A negative or unparseable value falls back rather than deleting
  // everything, because the failure mode of guessing wrong here is unrecoverable.
  if (!Number.isFinite(parsed) || parsed < 0) return RETENTION_DAYS_DEFAULT;
  return parsed;
}

export async function pruneOldTraces(
  maxAgeDays = resolveRetentionDays(),
  dir = LOG_DIR,
): Promise<{ removed: number; kept: number }> {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let removed = 0;
  let kept = 0;
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const full = path.join(dir, file);
      try {
        const info = await stat(full);
        if (info.mtimeMs < cutoff) {
          await unlink(full);
          removed += 1;
        } else {
          kept += 1;
        }
      } catch {
        /* a file that vanished under us needs no handling */
      }
    }
  } catch {
    /* no log directory yet is the normal first-run state, not an error */
  }
  return { removed, kept };
}

export function createTracer(conversationId: string, engineId: string): Tracer {

  const file = path.join(LOG_DIR, `${sanitiseId(conversationId)}.jsonl`);
  const turnId = randomUUID();
  let queue: Promise<void> = Promise.resolve();

  const log = (record: TraceRecord): void => {
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      conversationId,
      turnId,
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
    turnId,
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
