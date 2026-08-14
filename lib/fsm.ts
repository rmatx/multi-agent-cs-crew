/**
 * Client turn FSM: idle → running → done.
 *
 * This is a MIRROR of the server turn lifecycle in SAD §2 ("Turn lifecycle"), not a second
 * source of truth. The client never decides that a turn ended — it learns it from the
 * `done` / `error` StreamEvent and stores the status the server sent.
 *
 * Illegal transitions are unrepresentable: `transition` is total over
 * (state, event) and returns the same state for events that do not move it, and only the
 * `done` variant carries a status.
 */

import type { StreamEvent, TurnStatus } from "@shared/dto";

export type TurnState =
  | { phase: "idle" }
  | { phase: "running"; conversationId: string | null; text: string }
  | { phase: "done"; conversationId: string | null; text: string; status: TurnStatus }
  | { phase: "done"; conversationId: string | null; text: string; status: TurnStatus; error: TurnError };

export type TurnError = { code: string; message: string; retryable: boolean };

export type TurnAction =
  | { kind: "submit" }
  | { kind: "event"; event: StreamEvent }
  | { kind: "reset" };

export const initialTurnState: TurnState = { phase: "idle" };

export function transition(state: TurnState, action: TurnAction): TurnState {
  switch (action.kind) {
    case "submit":
      // Only a turn that is not in flight may start. Guards double-send.
      return state.phase === "running"
        ? state
        : { phase: "running", conversationId: conversationIdOf(state), text: "" };

    case "reset":
      return { phase: "idle" };

    case "event":
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: TurnState, event: StreamEvent): TurnState {
  // Events are only meaningful while a turn is in flight.
  if (state.phase !== "running") return state;

  switch (event.type) {
    case "session":
      return { ...state, conversationId: event.conversationId };
    case "token":
      return { ...state, text: state.text + event.text };
    case "done":
      return {
        phase: "done",
        conversationId: state.conversationId,
        text: state.text,
        status: event.status,
      };
    case "error":
      return {
        phase: "done",
        conversationId: state.conversationId,
        text: state.text,
        status: "escalated",
        error: { code: event.code, message: event.message, retryable: event.retryable },
      };
    // Trace/telemetry frames do not move the FSM in this slice.
    case "agent_hop":
    case "tool_call":
    case "citation":
    case "escalation":
    case "csat_prompt":
      return state;
  }
}

export function conversationIdOf(state: TurnState): string | null {
  return state.phase === "idle" ? null : state.conversationId;
}

export function isRunning(state: TurnState): boolean {
  return state.phase === "running";
}

export function errorOf(state: TurnState): TurnError | null {
  return state.phase === "done" && "error" in state ? state.error : null;
}
