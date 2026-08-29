/**
 * Runtime validation for the frozen `StreamEvent` contract — `integration.md` OQ-5, and the
 * last unmet item in the adapter's Quality Gates ("Enforce structured output contracts using
 * output schema validation or post-write validators").
 *
 * THIS FILE ADDS NO SHAPE. It validates `dto.ts` and restates nothing, so the contract-freeze
 * gate is untouched: a new variant means editing the union AND this file, and the tests here
 * fail loudly if only one of them moves.
 *
 * WHY HAND-WRITTEN RATHER THAN ZOD. Zod is already a dependency, but only on the server, where
 * the SDK's `tool()` helper requires it. Using it here would put a schema library in the
 * CLIENT bundle for nine object shapes — the same trade this project has declined twice
 * already (`node:sqlite` over `better-sqlite3`, no markdown renderer for the sake of bold
 * text). The validator is fifty lines, has no dependencies, and is exhaustively tested.
 *
 * WHAT IT IS FOR. `parseFrame` used to accept any object with a `type` field and cast. That is
 * safe exactly as long as the only producer is our own route handler — and "the only thing
 * upstream is our own server" is an assumption that survives right up until a proxy, a
 * mock, a replay tool, or a future non-Next backend sits in between. A malformed frame then
 * reaches the FSM as an unknown variant carrying undefined fields, and surfaces as a blank
 * message or a missing terminal state rather than as a parse error anyone can find.
 */

import type { StreamEvent, TurnStatus } from "./dto";

const TERMINAL_STATUSES: readonly TurnStatus[] = ["resolved", "escalated", "needs_input"];

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Narrow an unknown value to a `StreamEvent`, or return null.
 *
 * Deliberately strict about REQUIRED fields and deliberately silent about extra ones: an
 * unexpected property is how a wire contract grows without breaking old clients, while a
 * missing `status` on a `done` frame is a turn the client cannot end.
 */
export function parseStreamEvent(value: unknown): StreamEvent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;

  switch (event["type"]) {
    case "session":
      return isString(event["conversationId"])
        ? { type: "session", conversationId: event["conversationId"] }
        : null;

    case "token":
      return isString(event["text"]) ? { type: "token", text: event["text"] } : null;

    case "agent_hop":
      return isString(event["agentId"]) && isFiniteNumber(event["hop"])
        ? { type: "agent_hop", agentId: event["agentId"], hop: event["hop"] }
        : null;

    case "tool_call":
      return isString(event["agentId"]) && isString(event["tool"])
        ? { type: "tool_call", agentId: event["agentId"], tool: event["tool"] }
        : null;

    case "citation":
      return Array.isArray(event["ids"]) && event["ids"].every(isString)
        ? { type: "citation", ids: [...(event["ids"] as string[])] }
        : null;

    case "escalation":
      return isString(event["ticketStubId"]) && isString(event["reasonCode"])
        ? {
            type: "escalation",
            ticketStubId: event["ticketStubId"],
            reasonCode: event["reasonCode"],
          }
        : null;

    case "csat_prompt":
      return { type: "csat_prompt" };

    case "error":
      return isString(event["code"]) &&
        isString(event["message"]) &&
        typeof event["retryable"] === "boolean"
        ? {
            type: "error",
            code: event["code"],
            message: event["message"],
            retryable: event["retryable"],
          }
        : null;

    case "done":
      return TERMINAL_STATUSES.includes(event["status"] as TurnStatus)
        ? { type: "done", status: event["status"] as TurnStatus }
        : null;

    default:
      // An unknown `type` is not an error to shout about — a newer server may legitimately
      // send a frame this client predates. Dropping it is the compatible behaviour; the FSM
      // ignores unknown variants anyway, and this makes that explicit rather than incidental.
      return null;
  }
}
