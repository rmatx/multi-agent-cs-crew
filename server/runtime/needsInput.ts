/**
 * The clarifying-question control marker and its stream-safe filter.
 *
 * THIS MODULE HAS NO IMPORTS, ON PURPOSE — same reasoning as `toolRegistry.ts`: it is loaded
 * by `agents.ts` (which teaches the marker in the coordinator prompt), by `engines/sdk.ts`
 * (which strips it), and by its own unit test under `node --test` type stripping, which
 * cannot drag in Next or the Agent SDK.
 *
 * Why a marker at all: the terminal status of a turn is `needs_input` only when the
 * coordinator is genuinely waiting on the customer. That used to be inferred from
 * `buffered.trimEnd().endsWith("?")`, which was wrong twice over — it could not tell a
 * clarifying question from an answer that happened to end in a question mark, and under
 * `SDK_STREAM_MODE=live` it read an always-empty buffer, so the branch was unreachable.
 * The coordinator now declares the state instead of the runtime guessing at it.
 */

/** Appended by the coordinator to a clarifying question. Never reaches the customer. */
export const NEEDS_INPUT_MARKER = "<<NEEDS_INPUT>>";

/**
 * Length of the longest suffix of `text` that is a proper prefix of `marker`.
 *
 * Live mode emits coordinator text as it arrives, so the marker can straddle two deltas
 * ("...<<NEED" + "S_INPUT>>"). Holding back exactly this many trailing characters guarantees
 * a marker is never half-emitted, while releasing everything that provably cannot start one.
 */
export function heldBackLength(text: string, marker: string = NEEDS_INPUT_MARKER): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let n = max; n > 0; n -= 1) {
    if (text.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}

/** Removes every occurrence of the marker and reports whether one was present. */
export function stripMarker(text: string): { text: string; found: boolean } {
  if (!text.includes(NEEDS_INPUT_MARKER)) return { text, found: false };
  return { text: text.split(NEEDS_INPUT_MARKER).join(""), found: true };
}

export interface MarkerFilter {
  /** Feed one delta; returns the text that is safe to emit now (may be empty). */
  push(delta: string): string;
  /** End of stream: returns any held text, which cannot be a marker any more. */
  flush(): string;
  /** Whether a complete marker was seen at any point. */
  found(): boolean;
}

/** Stateful filter for live mode. One per turn. */
export function createMarkerFilter(): MarkerFilter {
  let held = "";
  let seen = false;

  return {
    push(delta: string): string {
      const stripped = stripMarker(held + delta);
      if (stripped.found) seen = true;
      const hold = heldBackLength(stripped.text);
      const releasable = stripped.text.slice(0, stripped.text.length - hold);
      held = stripped.text.slice(stripped.text.length - hold);
      return releasable;
    },
    flush(): string {
      const rest = held;
      held = "";
      return rest;
    },
    found(): boolean {
      return seen;
    },
  };
}
