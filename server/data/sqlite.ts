/**
 * SQLite connection helpers for the two WRITABLE stores — ADR-10.
 *
 * Two databases, never one, and neither of them is the practice DuckDB (ADR-06: the practice
 * DB is opened read-only and is never written, not even for tickets):
 *
 *   data/sessions.sqlite      SessionState + transcript + CSAT
 *   data/ticket_stubs.sqlite  EscalationPackage rows
 *
 * `node:sqlite` is used deliberately in preference to `better-sqlite3`. It is built into Node
 * (stable since 22.5), so the durable-store layer adds ZERO dependencies to a project whose
 * dependency list is itself part of the security story — one fewer native module to audit,
 * rebuild per platform, and keep patched. The API is synchronous, which suits both call sites:
 * a turn writes a handful of rows, and the alternative is an async store threaded through
 * engine code that has no other reason to be async.
 *
 * WAL is on so a read of the trace/stub tables never blocks a turn writing to them.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

function resolvePath(envVar: string, defaultRelative: string): string {
  const fromEnv = process.env[envVar]?.trim();
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : defaultRelative;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function resolveSessionDbPath(): string {
  return resolvePath("SESSION_DB_PATH", "data/sessions.sqlite");
}

export function resolveTicketStubDbPath(): string {
  return resolvePath("TICKET_STUB_DB_PATH", "data/ticket_stubs.sqlite");
}

/**
 * `:memory:` is honoured verbatim so a test — or a deployment that wants stateless turns —
 * can opt out of the file entirely without a second code path.
 */
function open(dbPath: string): DatabaseSync {
  if (dbPath.endsWith(":memory:")) return new DatabaseSync(":memory:");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // A turn should fail loudly rather than hang behind another writer.
  db.exec("PRAGMA busy_timeout = 2000");
  return db;
}

/**
 * Lazily opened, process-wide. Schema is created on first open and is idempotent, so a fresh
 * clone needs no migration step — the demo works from `git clone` with no setup command.
 */
type LazyDb = { (): Db; reset: () => void };

function lazy(pathFn: () => string, schema: string): LazyDb {
  let db: Db | null = null;
  const get = (): Db => {
    if (db === null) {
      db = open(pathFn());
      db.exec(schema);
    }
    return db;
  };
  get.reset = (): void => {
    if (db === null) return; // never opened — opening it just to close it would create the file
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  };
  return get;
}

const SESSION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    conversation_id TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    user_id         INTEGER,
    order_id        INTEGER,
    csat_score      INTEGER,
    csat_comment    TEXT,
    csat_at         TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    status          TEXT,
    ts              TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, id);
`;

const STUB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ticket_stubs (
    ticket_stub_id     TEXT PRIMARY KEY,
    conversation_id    TEXT NOT NULL,
    intent             TEXT NOT NULL,
    entities           TEXT NOT NULL,
    urgency            TEXT NOT NULL,
    transcript_summary TEXT NOT NULL,
    tools_tried        TEXT NOT NULL,
    citations          TEXT NOT NULL,
    reason_code        TEXT NOT NULL,
    suggested_category TEXT NOT NULL,
    created_at         TEXT NOT NULL
  );
  -- The idempotency key from Sprint 1, now enforced by the database rather than by a scan:
  -- a replayed turn cannot open a second ticket for the same reason on the same conversation.
  CREATE UNIQUE INDEX IF NOT EXISTS ticket_stubs_idempotency
    ON ticket_stubs (conversation_id, reason_code);
`;

export const sessionDb = lazy(resolveSessionDbPath, SESSION_SCHEMA);
export const ticketStubDb = lazy(resolveTicketStubDbPath, STUB_SCHEMA);

/**
 * Test seam: close and forget both handles so a test can point at a fresh file. A store that
 * was never opened stays unopened — opening one here just to close it would create the file
 * the test was trying to avoid.
 */
export function resetSqliteForTests(): void {
  sessionDb.reset();
  ticketStubDb.reset();
}
