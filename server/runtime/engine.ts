/**
 * The engine seam (SAD §4 "Runtime integration layer" step 3–4).
 *
 * `app/api/chat/route.ts` owns parse → validate → temporal → SSE pump and NOTHING else.
 * Everything that decides what to say lives behind `TurnEngine`. Two implementations:
 *
 *   deterministic — `engines/deterministic.ts`. No LLM, no API key, no network. DEFAULT.
 *   sdk           — `engines/sdk.ts`. claude-agent-sdk crew. Opt-in via `CHAT_ENGINE=sdk`.
 *
 * Both speak the same frozen `StreamEvent` DTOs (packages/shared/src/dto.ts), so the wire
 * contract, the UI, and the mock stream are untouched by the choice.
 */

import type { StreamEvent, TemporalMeta } from "@shared/dto";

/**
 * What an agent is permitted to know about time (SAD §4 temporal layer).
 *
 * ONLY `asOf`. `shiftDays`, `alignMaxDateToToday` and `overlayHit` are operator-trace fields
 * and are deliberately NOT in this type: an agent that can read `shiftDays` can subtract it
 * back off and reason about the real 2024 dates, which is exactly what the temporal layer
 * exists to prevent. Dates the agent sees are already shifted by the repository adapter.
 */
export type AgentTemporalView = {
  readonly asOf: string;
};

/** Narrowing projection. The only sanctioned way to get from TemporalMeta to agent-visible time. */
export function toAgentTemporalView(meta: TemporalMeta): AgentTemporalView {
  return { asOf: meta.asOf };
}

export type TurnInput = {
  readonly conversationId: string;
  readonly message: string;
  readonly identity: { readonly userId?: number; readonly orderId?: number };
  /**
   * Device / app version the customer has stated anywhere in this conversation (AC-TICKET-01).
   * Derived by the runtime from their own words, never asked of a model.
   */
  readonly appContext: { readonly device?: string; readonly app_version?: string };
  /**
   * What was already said on this conversation, oldest first, EXCLUDING this turn's message.
   * Empty on the first turn. Engines may ignore it — the deterministic engine does, because it
   * composes from one order row and has no use for context — but the sdk coordinator reads it
   * so a follow-up question ("can I return it?") knows what "it" is.
   */
  readonly history: readonly { role: "user" | "assistant"; content: string }[];
  /** Operator trace requested. Gates `agent_hop` / `tool_call` frames (SAD §4). */
  readonly trace: boolean;
  /** Full temporal meta. Engines pass only `toAgentTemporalView(...)` to any model. */
  readonly temporal: TemporalMeta;
  /** Aborts on client disconnect or turn timeout (SAD §2 Cancellation). */
  readonly signal: AbortSignal;
};

/** Emit one SSE frame. Frames after `done` are dropped by the route's pump. */
export type TurnEmit = (event: StreamEvent) => void;

export interface TurnEngine {
  readonly id: "deterministic" | "sdk";
  /**
   * Run one turn to a terminal `done`. Implementations SHOULD emit their own terminal frame;
   * if they throw or return without one, the route emits the safe fallback.
   */
  runTurn(input: TurnInput, emit: TurnEmit): Promise<void>;
}

/** Whitespace-preserving tokenizer shared by both engines so the wire cadence matches. */
export function chunk(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part.length > 0);
}

/** Stream a block of text as `token` frames, preserving the trailing newline per line. */
export function emitLines(emit: TurnEmit, lines: readonly string[]): void {
  for (const line of lines) {
    for (const part of chunk(line)) emit({ type: "token", text: part });
    emit({ type: "token", text: "\n" });
  }
}
