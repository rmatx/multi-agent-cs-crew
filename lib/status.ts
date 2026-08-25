/**
 * The one place crew status is named and coloured.
 *
 * Banner, pill, buttons and inline messages all read from here, so a status can
 * never be called "running" in one place and "Sending…" in another. Adding a
 * status means adding it once, in this file.
 *
 * Tones follow the agreed vocabulary — gray idle, blue running, green done, red
 * error — plus one addition: `attention` (amber) for a turn that finished
 * without answering (`needs_input`, `escalated`). Those are not failures, but
 * colouring them green would claim a success that did not happen.
 */

import type { TurnState } from "@/lib/fsm";
import { errorOf } from "@/lib/fsm";

export type StatusTone = "idle" | "running" | "done" | "attention" | "error";

export type CrewStatus = {
  tone: StatusTone;
  /** Banner text, e.g. "running". */
  label: string;
  /** One short line under the banner explaining what the label means. */
  hint: string;
  /**
   * What the banner may honestly call itself. There is only a crew on the `sdk` engine; the
   * deterministic engine is a coded lookup with no agent in it, and labelling that "Crew"
   * claims the capstone's headline feature on a path that does not implement it.
   */
  prefix: string;
};

/** Turn engine reported by `/api/health`. `null` until that resolves. */
export type EngineId = "deterministic" | "sdk" | null;

const STATUS: Record<StatusTone, { label: string; hint: string }> = {
  idle: { label: "idle", hint: "Waiting for an order number and a question." },
  running: { label: "running", hint: "Looking that up." },
  done: { label: "done", hint: "Answered from order data." },
  attention: { label: "needs input", hint: "Could not answer with what it has." },
  error: { label: "error", hint: "The turn did not complete." },
};

export function crewStatus(state: TurnState, engine: EngineId = null): CrewStatus {
  const tone = toneOf(state);
  return { tone, ...STATUS[tone], prefix: enginePrefix(engine) };
}

function enginePrefix(engine: EngineId): string {
  if (engine === "sdk") return "Crew";
  if (engine === "deterministic") return "Support";
  return "Status"; // engine not known yet — claim nothing
}

function toneOf(state: TurnState): StatusTone {
  if (state.phase === "idle") return "idle";
  if (state.phase === "running") return "running";
  if (errorOf(state) !== null) return "error";
  return state.status === "resolved" ? "done" : "attention";
}

/** Button label for the primary control, phrased to match the banner. */
export function runLabel(state: TurnState): string {
  return state.phase === "running" ? "Running…" : "Run";
}

/** hh:mm:ss for the "last updated" readout. Local time; seconds matter here. */
export function formatUpdated(at: Date): string {
  return at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
