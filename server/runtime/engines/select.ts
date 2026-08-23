/**
 * Engine resolution (SAD §4 "Runtime integration layer" step 3).
 *
 * The sdk engine is loaded with a DYNAMIC import on purpose. On the default path the
 * claude-agent-sdk module graph is never evaluated: no CLI subprocess is located, no key is
 * read, no network stack is touched. A broken or unconfigured sdk engine therefore cannot
 * take the deterministic demo down — the worst case is one clean `error` frame on a request
 * that explicitly asked for `CHAT_ENGINE=sdk`.
 */

import type { EngineId } from "../config";
import type { TurnEngine } from "../engine";
import { deterministicEngine } from "./deterministic";

export type EngineLoad =
  | { ok: true; engine: TurnEngine }
  | { ok: false; code: string; message: string };

export async function loadEngine(id: EngineId): Promise<EngineLoad> {
  if (id === "deterministic") return { ok: true, engine: deterministicEngine };

  try {
    const mod = await import("./sdk");
    return { ok: true, engine: mod.sdkEngine };
  } catch (err) {
    console.error("sdk engine failed to load", err);
    return {
      ok: false,
      code: "sdk_engine_unavailable",
      message:
        "The sdk engine could not be loaded. Unset CHAT_ENGINE to fall back to the " +
        "deterministic engine.",
    };
  }
}
