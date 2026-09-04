/**
 * EscalationPackage validator + durable TicketStubStore (SAD §4 "EscalationPackage
 * (normative shape)", PRD F-ESC-01 / F-TICKET-01, ADR-10).
 *
 * The store is SQLite as of Sprint 2 layer 1 — `data/ticket_stubs.sqlite`, never the practice
 * DuckDB (ADR-06). It was an in-memory Map through Sprint 1, which the SAD explicitly allowed
 * and which had one property nobody wants in a demo: every open ticket vanished on restart,
 * so "a human will pick this up" was true only until the next `npm run dev`.
 *
 * All seven `ReasonCode` values are accepted and reachable; the validator is full-strength
 * because it is what the eval asserts.
 *
 * `create_ticket_stub` REJECTS a partial package rather than writing a degraded stub. That
 * rejection is the mechanism behind PRD "100% complete escalations".
 */

import type { EscalationPackage, ReasonCode } from "@shared/dto";
import { ticketStubDb } from "@/server/data/sqlite";
import { writeHandoffArtifacts } from "./handoffArtifacts";

const REASON_CODES: readonly ReasonCode[] = [
  "customer_requested_human",
  "ungrounded",
  "restricted_action",
  "low_confidence",
  "repeat_failure",
  "high_severity",
  "payment_or_refund",
];

const URGENCIES = ["low", "medium", "high", "critical"] as const;

/** Reason codes where the customer may legitimately never have supplied an identifier. */
const IDENTIFIER_EXEMPT: readonly ReasonCode[] = ["customer_requested_human", "ungrounded"];

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * SAD "Validator rule (QA-checkable)", implemented literally so QA can diff it against the
 * document.
 */
export function validateEscalationPackage(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["package must be an object"] };
  }
  const pkg = input as Record<string, unknown>;

  for (const field of [
    "conversationId",
    "intent",
    "transcript_summary",
    "suggested_category",
  ]) {
    if (!nonEmptyString(pkg[field])) errors.push(`${field} must be a non-empty string`);
  }

  if (!URGENCIES.includes(pkg["urgency"] as (typeof URGENCIES)[number])) {
    errors.push(`urgency must be one of ${URGENCIES.join(" | ")}`);
  }

  const reasonCode = pkg["reason_code"];
  if (!REASON_CODES.includes(reasonCode as ReasonCode)) {
    errors.push(`reason_code must be one of ${REASON_CODES.join(" | ")}`);
  }

  const entities = pkg["entities"];
  if (typeof entities !== "object" || entities === null || Array.isArray(entities)) {
    errors.push("entities must be present (empty object allowed)");
  } else if (!IDENTIFIER_EXEMPT.includes(reasonCode as ReasonCode)) {
    const e = entities as Record<string, unknown>;
    if (typeof e["order_id"] !== "number" && typeof e["user_id"] !== "number") {
      errors.push("entities must contain order_id or user_id for this reason_code");
    }
  }

  if (!Array.isArray(pkg["tools_tried"])) errors.push("tools_tried must be an array");
  if (!Array.isArray(pkg["citations"])) errors.push("citations must be an array");

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export type StoredStub = EscalationPackage;

type StubRow = {
  ticket_stub_id: string;
  conversation_id: string;
  intent: string;
  entities: string;
  urgency: string;
  transcript_summary: string;
  tools_tried: string;
  citations: string;
  reason_code: string;
  suggested_category: string;
  created_at: string;
};

/** Rehydrate a row into the normative package shape the DTO and the eval both expect. */
function toStub(row: StubRow): StoredStub {
  return {
    ticket_stub_id: row.ticket_stub_id,
    conversationId: row.conversation_id,
    intent: row.intent,
    entities: JSON.parse(row.entities) as StoredStub["entities"],
    urgency: row.urgency as StoredStub["urgency"],
    transcript_summary: row.transcript_summary,
    tools_tried: JSON.parse(row.tools_tried) as StoredStub["tools_tried"],
    citations: JSON.parse(row.citations) as string[],
    reason_code: row.reason_code as ReasonCode,
    suggested_category: row.suggested_category,
    created_at: row.created_at,
  };
}

export type CreateStubResult =
  | { ok: true; ticket_stub_id: string; stub: StoredStub }
  | { ok: false; errors: string[] };

/**
 * Idempotent on `conversationId + reason_code`: a replayed turn returns the existing stub id
 * instead of opening a second ticket (adapter Execution: "Define retry and idempotency
 * behavior for runtime actions that may be replayed").
 */
export function createTicketStub(
  input: unknown,
  clock: { asOf: string },
): CreateStubResult {
  const validation = validateEscalationPackage(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const pkg = input as Omit<EscalationPackage, "ticket_stub_id" | "created_at">;
  const db = ticketStubDb();

  // Idempotency is now a UNIQUE INDEX on (conversation_id, reason_code) rather than a scan of
  // an in-memory map. Same contract, enforced one layer down, and it survives a restart.
  const existing = db
    .prepare("SELECT * FROM ticket_stubs WHERE conversation_id = ? AND reason_code = ?")
    .get(pkg.conversationId, pkg.reason_code) as StubRow | undefined;
  if (existing !== undefined) {
    return { ok: true, ticket_stub_id: existing.ticket_stub_id, stub: toStub(existing) };
  }

  const ticket_stub_id = `STUB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  // asOf-aware clock (SAD: "ISO; stamped with asOf-aware clock") so a pinned-date eval run
  // produces a stable created_at date component.
  const created_at = `${clock.asOf}T00:00:00.000Z`;
  const stub: StoredStub = { ...pkg, ticket_stub_id, created_at };

  /*
   * Human-readable artifacts, written HERE because this is the one place both engines meet.
   *
   * The first attempt hooked the sdk engine's tool wrapper, which produced nothing on the
   * deterministic path — that engine calls this function directly and never touches the MCP
   * tool server. Escalation is structural on both engines (ADR-16), so the artifact has to be
   * too, or the keyless demo silently loses the handoff packet.
   *
   * Written by the RUNTIME, not by a tool the model calls: an observation of something that
   * already happened is not the model's to reproduce, and a `send_email` tool would add an
   * outbound-communication capability to a registry that asserts every tool by name. Nothing
   * here sends anything — see handoffArtifacts.ts.
   */
  writeHandoffArtifacts(
    { ...stub, conversation_id: stub.conversationId },
    clock.asOf,
  );

  db.prepare(
    `INSERT INTO ticket_stubs (
       ticket_stub_id, conversation_id, intent, entities, urgency, transcript_summary,
       tools_tried, citations, reason_code, suggested_category, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ticket_stub_id,
    stub.conversationId,
    stub.intent,
    JSON.stringify(stub.entities),
    stub.urgency,
    stub.transcript_summary,
    JSON.stringify(stub.tools_tried),
    JSON.stringify(stub.citations),
    stub.reason_code,
    stub.suggested_category,
    created_at,
  );

  return { ok: true, ticket_stub_id, stub };
}

export function getTicketStub(id: string): StoredStub | undefined {
  const row = ticketStubDb()
    .prepare("SELECT * FROM ticket_stubs WHERE ticket_stub_id = ?")
    .get(id) as StubRow | undefined;
  return row === undefined ? undefined : toStub(row);
}

/** Operator read: the tickets opened on one conversation, oldest first. */
export function listTicketStubsForConversation(conversationId: string): StoredStub[] {
  const rows = ticketStubDb()
    .prepare("SELECT * FROM ticket_stubs WHERE conversation_id = ? ORDER BY created_at, rowid")
    .all(conversationId) as StubRow[];
  return rows.map(toStub);
}

/** Customer-safe handoff text. No raw tool JSON, no PII beyond ids (SAD §8 redaction). */
export function formatHandoffSummary(stub: StoredStub): string {
  const ids = [
    stub.entities.order_id !== undefined ? `order ${stub.entities.order_id}` : null,
    stub.entities.user_id !== undefined ? `account ${stub.entities.user_id}` : null,
  ].filter((part): part is string => part !== null);

  return [
    `Ticket ${stub.ticket_stub_id} is open with our support team.`,
    ids.length > 0 ? `It references ${ids.join(" and ")}.` : null,
    `Reason: ${stub.reason_code.replace(/_/g, " ")}.`,
    "A human will pick this up — I can't process refunds, cancellations, or payments myself.",
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
}
