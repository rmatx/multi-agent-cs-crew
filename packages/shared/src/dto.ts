/**
 * Frozen wire contract — SAD §4 "API contracts (normative)".
 *
 * These shapes are copied VERBATIM from project-context/1.define/sad.md §4 and are frozen
 * per the SAD "Contract freeze gate (blocking)". The UI, the mock stream, and the route
 * handler all import from this file; none of them restate these types. Any change here is a
 * blocking Integration risk and must be noted in integration.md.
 */

/** POST /api/chat request body. */
export type ChatRequest = {
  conversationId?: string;       // create if absent
  message: string;
  identity?: { userId?: number; orderId?: number };
  clientFlags?: { trace?: boolean };
};

/** SSE frame payloads for POST /api/chat (Content-Type: text/event-stream). */
export type StreamEvent =
  | { type: "session"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "agent_hop"; agentId: string; hop: number }      // omit if !trace
  | { type: "tool_call"; agentId: string; tool: string }     // omit/redact if !trace
  | { type: "citation"; ids: string[] }
  | { type: "escalation"; ticketStubId: string; reasonCode: string }
  | { type: "csat_prompt" }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done"; status: "resolved" | "escalated" | "needs_input" };

/** Terminal status carried by the `done` event. */
export type TurnStatus = Extract<StreamEvent, { type: "done" }>["status"];

export type ReasonCode =
  | "customer_requested_human"
  | "ungrounded"
  | "restricted_action"
  | "low_confidence"
  | "repeat_failure"
  | "high_severity"
  | "payment_or_refund";

export type EscalationPackage = {
  // --- required ---
  conversationId: string;
  intent: string;                                  // from SessionState.intent; "other" if unresolved
  entities: {                                      // what triage/specialists actually extracted
    order_id?: number;
    user_id?: number;
    device?: string;
    app_version?: string;
  };
  urgency: "low" | "medium" | "high" | "critical";
  transcript_summary: string;                      // customer-safe; no raw tool JSON, no PII beyond ids
  tools_tried: Array<{ tool: string; ok: boolean; summary: string }>;  // may be [] — must be present
  citations: string[];                             // may be [] — must be present
  reason_code: ReasonCode;
  suggested_category: string;                      // `other` for app_issue (ADR-13)
  // --- populated on write ---
  ticket_stub_id: string;                          // returned by create_ticket_stub
  created_at: string;                              // ISO; stamped with asOf-aware clock
};

/**
 * Tool result summary shapes referenced by the freeze gate. Sprint 1 needs exactly one:
 * the order read behind `get_order` / `get_order_items`. Dates are already shifted by the
 * repository adapter (SAD §4 temporal layer) — raw practice-DB dates never leave the server.
 */
export type OrderLineItem = {
  productName: string;
  quantity: number;
  lineTotal: number;
  /**
   * Product category. Present so a returns answer can be QUALIFIED, not just dated: the corpus
   * excludes opened personal-care items from returns, and without a category the advisor could
   * only ever check the 14-day window — telling a customer with a beauty order "yes, you can
   * return it" when the policy says otherwise. Deliberately NOT `price` or `cost`: the crew has
   * no business seeing margin.
   */
  category: string;
};

export type OrderSummary = {
  orderId: number;
  userId: number;
  status: string;
  orderDate: string;        // ISO date, SHIFTED
  totalAmount: number;
  items: OrderLineItem[];
};

/** Temporal metadata required in the operator trace (SAD §4, Sprint 1 exit criteria). */
export type TemporalMeta = {
  asOf: string;             // ISO date
  shiftDays: number;
  alignMaxDateToToday: boolean;
  overlayHit: boolean;
};
