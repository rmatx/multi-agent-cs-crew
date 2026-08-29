/**
 * SessionStore — ADR-10, SAD §2 `SessionState`, PRD F-CSAT-01.
 *
 * Sprint 1 had no session at all: every turn started cold, so "can I return it?" after "where
 * is order 46101?" was unanswerable, and the identity the customer had already given was
 * thrown away between turns. That is the gap this closes.
 *
 * TWO THINGS ARE PERSISTED AND A THIRD DELIBERATELY IS NOT:
 *   - the transcript, so the coordinator can read what was already said;
 *   - the identity last supplied, so an order id given in turn 1 still applies in turn 3;
 *   - NOT tool results or citations. Those are per-turn evidence. Replaying a fact a tool
 *     returned twenty minutes ago as if it were fresh is how a support bot states a stale
 *     order status with total confidence; the tools are cheap and the DuckDB read is local,
 *     so every turn re-reads what it needs.
 *
 * Scope: one conversation id, no cross-user memory (SAD §2 "Sessions / resume"). Nothing here
 * joins two conversations, and nothing is keyed on a customer.
 */

import { sessionDb } from "@/server/data/sqlite";

/** How much history a turn may see. Older messages are dropped, oldest first. */
const MAX_TRANSCRIPT_TURNS = 12;

/** Hard cap per stored message, so one pathological paste cannot bloat every later prompt. */
const MAX_MESSAGE_CHARS = 4000;

export type TranscriptEntry = {
  readonly role: "user" | "assistant";
  readonly content: string;
  /** Terminal status of the turn this assistant message ended, when it ended one. */
  readonly status: string | null;
  readonly ts: string;
};

export type SessionIdentity = { userId?: number; orderId?: number };

export type Session = {
  readonly conversationId: string;
  readonly identity: SessionIdentity;
  readonly transcript: readonly TranscriptEntry[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

type SessionRow = { conversation_id: string; user_id: number | null; order_id: number | null };
type MessageRow = { role: string; content: string; status: string | null; ts: string };

/** Create the session row if absent. Safe to call on every turn. */
export function ensureSession(conversationId: string): void {
  const ts = nowIso();
  sessionDb()
    .prepare(
      `INSERT INTO sessions (conversation_id, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (conversation_id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(conversationId, ts, ts);
}

export function loadSession(conversationId: string): Session {
  const db = sessionDb();
  const row = db
    .prepare("SELECT conversation_id, user_id, order_id FROM sessions WHERE conversation_id = ?")
    .get(conversationId) as SessionRow | undefined;

  const messages = db
    .prepare(
      `SELECT role, content, status, ts FROM messages
        WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(conversationId, MAX_TRANSCRIPT_TURNS * 2) as MessageRow[];

  return {
    conversationId,
    identity: {
      ...(row?.user_id === null || row?.user_id === undefined ? {} : { userId: row.user_id }),
      ...(row?.order_id === null || row?.order_id === undefined ? {} : { orderId: row.order_id }),
    },
    // Query is newest-first so the LIMIT keeps the RECENT window; reverse for reading order.
    transcript: messages
      .reverse()
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
        status: m.status,
        ts: m.ts,
      })),
  };
}

/**
 * Merge the identity supplied on this request into the stored one.
 *
 * Request wins where it is present; stored values fill the gaps. A customer who names a new
 * order id has changed the subject, and the old id must not shadow the new one — but one who
 * simply asks a follow-up should not have to repeat themselves.
 */
export function mergeIdentity(
  stored: SessionIdentity,
  fromRequest: SessionIdentity,
): SessionIdentity {
  return {
    ...(fromRequest.userId ?? stored.userId ? { userId: fromRequest.userId ?? stored.userId } : {}),
    ...(fromRequest.orderId ?? stored.orderId
      ? { orderId: fromRequest.orderId ?? stored.orderId }
      : {}),
  };
}

export function saveIdentity(conversationId: string, identity: SessionIdentity): void {
  sessionDb()
    .prepare(
      `UPDATE sessions SET user_id = ?, order_id = ?, updated_at = ?
        WHERE conversation_id = ?`,
    )
    .run(identity.userId ?? null, identity.orderId ?? null, nowIso(), conversationId);
}

export function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  status: string | null = null,
): void {
  if (content.trim().length === 0) return;
  sessionDb()
    .prepare(
      "INSERT INTO messages (conversation_id, role, content, status, ts) VALUES (?, ?, ?, ?, ?)",
    )
    .run(conversationId, role, clamp(content), status, nowIso());
}

export type CsatResult = { ok: true } | { ok: false; code: string; message: string };

/**
 * Record a CSAT response (PRD F-CSAT-01). Idempotent by overwrite: a customer who changes
 * their mind gets their latest answer stored rather than a second row.
 */
export function recordCsat(
  conversationId: string,
  score: number,
  comment?: string,
): CsatResult {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, code: "invalid_score", message: "`score` must be an integer 1-5." };
  }
  const changed = sessionDb()
    .prepare(
      `UPDATE sessions SET csat_score = ?, csat_comment = ?, csat_at = ?, updated_at = ?
        WHERE conversation_id = ?`,
    )
    .run(score, comment ?? null, nowIso(), nowIso(), conversationId);

  if (changed.changes === 0) {
    return { ok: false, code: "unknown_conversation", message: "No such conversation." };
  }
  return { ok: true };
}

export type CsatRecord = { score: number; comment: string | null; at: string } | null;

export function getCsat(conversationId: string): CsatRecord {
  const row = sessionDb()
    .prepare(
      "SELECT csat_score, csat_comment, csat_at FROM sessions WHERE conversation_id = ?",
    )
    .get(conversationId) as
    | { csat_score: number | null; csat_comment: string | null; csat_at: string | null }
    | undefined;
  if (row?.csat_score === null || row?.csat_score === undefined) return null;
  return { score: row.csat_score, comment: row.csat_comment, at: row.csat_at ?? "" };
}

/**
 * The transcript as the coordinator should read it: plain, oldest first, and WITHOUT the
 * current turn's message (the caller passes that separately as the actual question).
 */
export function formatTranscriptForPrompt(transcript: readonly TranscriptEntry[]): string {
  if (transcript.length === 0) return "";
  return transcript
    .map((entry) => `${entry.role === "user" ? "Customer" : "You"}: ${entry.content}`)
    .join("\n");
}
