/**
 * EscalationPackage validator + in-memory TicketStubStore (SAD §4 "EscalationPackage
 * (normative shape)", Sprint 1 Slice B, PRD F-ESC-01 / F-TICKET-01).
 *
 * Sprint 1 scope, exactly as the SAD allows: in-memory store, `payment_or_refund` path.
 * Durable SQLite (ADR-10) and the remaining six reason codes are Sprint 2 layer 1 — see
 * `stubs.ts`. The validator is full-strength now because it is what the eval asserts.
 *
 * `create_ticket_stub` REJECTS a partial package rather than writing a degraded stub. That
 * rejection is the mechanism behind PRD "100% complete escalations".
 */

import type { EscalationPackage, ReasonCode } from "@shared/dto";

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

/**
 * Process-local store. Deliberately NOT the practice DuckDB (ADR-06: the practice DB is
 * read-only and is never written, not even for tickets).
 */
const stubs = new Map<string, StoredStub>();

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
  const idempotencyKey = `${pkg.conversationId}::${pkg.reason_code}`;

  for (const existing of stubs.values()) {
    if (`${existing.conversationId}::${existing.reason_code}` === idempotencyKey) {
      return { ok: true, ticket_stub_id: existing.ticket_stub_id, stub: existing };
    }
  }

  const ticket_stub_id = `STUB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  // asOf-aware clock (SAD: "ISO; stamped with asOf-aware clock") so a pinned-date eval run
  // produces a stable created_at date component.
  const created_at = `${clock.asOf}T00:00:00.000Z`;
  const stub: StoredStub = { ...pkg, ticket_stub_id, created_at };
  stubs.set(ticket_stub_id, stub);
  return { ok: true, ticket_stub_id, stub };
}

export function getTicketStub(id: string): StoredStub | undefined {
  return stubs.get(id);
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
