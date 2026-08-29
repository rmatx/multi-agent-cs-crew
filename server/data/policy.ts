/**
 * PolicyRepository — loads the markdown corpus and answers `search_policy` (SAD §2 "Policy
 * Repository", ADR-11, PRD F-FAQ-01).
 *
 * Server-only: reads from `POLICY_CORPUS_PATH` (default `data/policy`). The corpus is
 * committed repo content, not customer data, so caching it for the process lifetime is safe —
 * but that only applies in production, see `shouldCache`.
 *
 * The grounding decision lives in `policyScore.ts`, which has no imports and is unit-tested
 * directly. This module only supplies it with files.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  POLICY_SCORE_THRESHOLD,
  chunkMarkdown,
  scoreChunks,
  type PolicyChunk,
  type ScoredChunk,
} from "./policyScore";

const DEFAULT_CORPUS_RELATIVE_PATH = "data/policy";

export function resolveCorpusPath(): string {
  const fromEnv = process.env.POLICY_CORPUS_PATH?.trim();
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_CORPUS_RELATIVE_PATH;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

let cachedChunks: PolicyChunk[] | null = null;

/**
 * Cache only outside development.
 *
 * The corpus is four small files, so re-reading them per call costs nothing measurable, and
 * process-lifetime caching in dev is an actual trap: editing a policy file appears to do
 * nothing until the server is restarted. That cost a live debugging round during Sprint 2 —
 * a corpus fix looked like a scorer bug because the running process still held the old text.
 */
function shouldCache(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Every `##` section across the corpus. Throws if the corpus is missing. */
export function loadPolicyChunks(): PolicyChunk[] {
  if (cachedChunks !== null && shouldCache()) return cachedChunks;

  const dir = resolveCorpusPath();
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();

  const chunks: PolicyChunk[] = [];
  for (const file of files) {
    const source = file.replace(/\.md$/, "");
    chunks.push(...chunkMarkdown(source, readFileSync(path.join(dir, file), "utf8")));
  }

  if (chunks.length === 0) {
    // Fail loudly: a silently empty corpus would turn every policy question into an
    // escalation and look like a routing bug rather than a missing-content bug.
    throw new Error(
      `Policy corpus at ${dir} contains no readable sections. ` +
        "Expected markdown files with '##' sections (PRD AC-FAQ-04).",
    );
  }

  cachedChunks = shouldCache() ? chunks : null;
  return chunks;
}

/** Test seam — the corpus is process-cached, so a test that swaps files must clear it. */
export function resetPolicyCache(): void {
  cachedChunks = null;
}

export type PolicySearchResult =
  | {
      readonly grounded: true;
      readonly topScore: number;
      readonly hits: readonly ScoredChunk[];
    }
  | {
      readonly grounded: false;
      readonly topScore: number;
      /** Best candidates WITHOUT their text — operator diagnostics only, never the model's. */
      readonly rejected: ReadonlyArray<{ id: string; score: number }>;
    };

/**
 * Search the corpus. Below `POLICY_SCORE_THRESHOLD` the caller gets NO chunk text.
 *
 * That is the whole grounding mechanism (AC-FAQ-01 / AC-FAQ-03): an agent cannot answer from
 * a weak hit it was never shown. Returning the text plus a "please don't use this" warning
 * would leave the guarantee resting on the model's compliance, which is exactly what
 * "escalate over invent" refuses to do.
 */
export function searchPolicy(query: string, topK: number): PolicySearchResult {
  const hits = scoreChunks(query, loadPolicyChunks(), topK);
  const topScore = hits[0]?.score ?? 0;

  if (topScore < POLICY_SCORE_THRESHOLD) {
    return {
      grounded: false,
      topScore,
      rejected: hits.slice(0, 3).map((hit) => ({ id: hit.chunk.id, score: hit.score })),
    };
  }

  return {
    grounded: true,
    topScore,
    hits: hits.filter((hit) => hit.score >= POLICY_SCORE_THRESHOLD),
  };
}
