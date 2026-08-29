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

/**
 * What the crew is doing right now, for the status banner.
 *
 * Populated from `agent_hop` / `tool_call`, which the server emits ONLY when the turn asked
 * for a trace. With trace off these stay null and the banner says nothing about agents —
 * that gate is deliberate (SAD §2 "customer sees one assistant voice"), so the UI reflects it
 * rather than working around it.
 */
export type TurnActivity = {
  /** Agent currently holding the turn, e.g. `order-specialist`. */
  agentId: string | null;
  /** Most recent tool it called, MCP prefix intact, e.g. `mcp__novamart__get_order`. */
  tool: string | null;
  /** Delegations so far this turn. 0 until the coordinator hands off. */
  hops: number;
};

const NO_ACTIVITY: TurnActivity = { agentId: null, tool: null, hops: 0 };

/**
 * One line of the operator trace, in the order it arrived.
 *
 * `activity` answers "what is happening now" for the banner; this answers "what happened" for
 * the TracePanel (F-TRACE-01), and the two are kept separate on purpose — a banner that had
 * to summarise a list would either lie or grow.
 *
 * The trail is built ONLY from frames the server chose to send. With trace off the server
 * withholds `agent_hop` and `tool_call` entirely, so the panel is empty rather than filtered:
 * the customer/operator split is enforced on the wire, and the client does not work around it.
 */
export type TraceEntry =
  | { kind: "hop"; agentId: string; hop: number }
  | { kind: "tool"; agentId: string; tool: string }
  | { kind: "citation"; ids: string[] }
  | { kind: "escalation"; ticketStubId: string; reasonCode: string }
  | { kind: "error"; code: string; message: string }
  | { kind: "done"; status: TurnStatus };

/** Cap so a pathological turn cannot grow the panel without bound. */
const MAX_TRAIL = 200;

function appended(trail: readonly TraceEntry[], entry: TraceEntry): TraceEntry[] {
  return trail.length >= MAX_TRAIL ? [...trail] : [...trail, entry];
}

export type TurnState =
  | { phase: "idle" }
  | {
      phase: "running";
      conversationId: string | null;
      text: string;
      activity: TurnActivity;
      trail: readonly TraceEntry[];
    }
  | {
      phase: "done";
      conversationId: string | null;
      text: string;
      status: TurnStatus;
      trail: readonly TraceEntry[];
    }
  | {
      phase: "done";
      conversationId: string | null;
      text: string;
      status: TurnStatus;
      trail: readonly TraceEntry[];
      error: TurnError;
    };

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
        : {
            phase: "running",
            conversationId: conversationIdOf(state),
            text: "",
            activity: NO_ACTIVITY,
            trail: [],
          };

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
        trail: appended(state.trail, { kind: "done", status: event.status }),
      };
    case "error":
      // An error frame does NOT end the turn on its own — the server still owes a `done`, and
      // the envelope guarantees it. But the client must not lose the error if the stream dies
      // first, so it terminates here and records the error in the trail either way.
      return {
        phase: "done",
        conversationId: state.conversationId,
        text: state.text,
        status: "escalated",
        trail: appended(state.trail, { kind: "error", code: event.code, message: event.message }),
        error: { code: event.code, message: event.message, retryable: event.retryable },
      };
    // A hop replaces the whole activity: the new agent has not called anything yet, so
    // carrying the previous agent's tool forward would show the banner a tool that the named
    // agent never ran.
    case "agent_hop":
      return {
        ...state,
        activity: { agentId: event.agentId, tool: null, hops: event.hop },
        trail: appended(state.trail, { kind: "hop", agentId: event.agentId, hop: event.hop }),
      };

    case "tool_call":
      return {
        ...state,
        activity: { ...state.activity, agentId: event.agentId, tool: event.tool },
        trail: appended(state.trail, { kind: "tool", agentId: event.agentId, tool: event.tool }),
      };

    case "citation":
      return { ...state, trail: appended(state.trail, { kind: "citation", ids: event.ids }) };

    case "escalation":
      return {
        ...state,
        trail: appended(state.trail, {
          kind: "escalation",
          ticketStubId: event.ticketStubId,
          reasonCode: event.reasonCode,
        }),
      };

    // The CSAT prompt is a UI cue, not a step in the turn: the page renders the question, and
    // putting it in the trail would file "we asked how it went" as something the crew did.
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

/** Current activity, or a null one when no turn is in flight. */
export function activityOf(state: TurnState): TurnActivity {
  return state.phase === "running" ? state.activity : NO_ACTIVITY;
}

/** Everything the server let this client see about how the turn ran, in arrival order. */
export function trailOf(state: TurnState): readonly TraceEntry[] {
  return state.phase === "idle" ? [] : state.trail;
}

/** The ticket this turn opened, if it opened one. */
export function escalationOf(
  state: TurnState,
): { ticketStubId: string; reasonCode: string } | null {
  for (const entry of trailOf(state)) {
    if (entry.kind === "escalation") {
      return { ticketStubId: entry.ticketStubId, reasonCode: entry.reasonCode };
    }
  }
  return null;
}

/** Terminal status, or null while the turn is still running. */
export function statusOf(state: TurnState): TurnStatus | null {
  return state.phase === "done" ? state.status : null;
}
