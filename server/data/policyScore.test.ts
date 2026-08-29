/**
 * ADR-11 / AC-FAQ-01 / AC-FAQ-03 — the grounding threshold decides whether the crew answers
 * or hands the customer to a person, so it gets tested against the REAL corpus, not a
 * fixture. A test corpus would prove the arithmetic and nothing about the policy files the
 * demo actually answers from.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
type Mod = typeof import("./policyScore");
type PolicyChunk = Mod extends { chunkMarkdown: (...args: never[]) => infer R }
  ? R extends Array<infer C>
    ? C
    : never
  : never;

// Runtime-URL import for the same reason as `toolRegistry.test.ts`: `tsc --noEmit` rejects a
// `.ts` import extension without `allowImportingTsExtensions`, while Node's type stripper
// requires one. `policyScore.ts` has no imports of its own, so nothing else must resolve.
const { POLICY_SCORE_THRESHOLD, chunkMarkdown, scoreChunks, tokenize } = (await import(
  new URL("./policyScore.ts", import.meta.url).href
)) as Mod;

const CORPUS_DIR = path.join(process.cwd(), "data", "policy");

function loadCorpus(): PolicyChunk[] {
  const chunks: PolicyChunk[] = [];
  for (const file of readdirSync(CORPUS_DIR).filter((n) => n.endsWith(".md")).sort()) {
    chunks.push(
      ...chunkMarkdown(file.replace(/\.md$/, ""), readFileSync(path.join(CORPUS_DIR, file), "utf8")),
    );
  }
  return chunks;
}

const corpus = loadCorpus();
const top = (query: string) => scoreChunks(query, corpus, 3);

test("AC-FAQ-04: the four named corpus files are present and chunked", () => {
  const sources = new Set(corpus.map((c) => c.source));
  for (const required of ["returns", "shipping", "plus", "app_troubleshooting"]) {
    assert.ok(sources.has(required), `missing corpus file: ${required}.md`);
  }
  assert.ok(corpus.length >= 15, `expected a section-per-topic corpus, got ${corpus.length}`);
});

test("every chunk carries a citable id and non-empty text", () => {
  for (const chunk of corpus) {
    assert.match(chunk.id, /^policy:[a-z_]+#[a-z0-9-]+$/);
    assert.ok(chunk.text.trim().length > 0);
    assert.ok(chunk.heading.length > 0);
  }
});

test("in-corpus questions clear the 0.55 threshold and retrieve the right document", () => {
  const cases: Array<[string, string]> = [
    // Verbatim from a live sdk turn: this phrasing scored 0.5264 on the right section and
    // escalated a question the corpus plainly answers. The threshold is normative (ADR-11),
    // so the fix was the corpus — the section about membership benefits now uses the words
    // "membership" and "benefits". Kept as a regression case.
    ["Plus membership benefits what does Plus include", "plus"],
    ["return processing timeline after item received", "returns"],
    ["how long does the warehouse take to inspect a returned parcel", "returns"],
    ["How long do I have to return something?", "returns"],
    ["What is the return window?", "returns"],
    ["How long does a return take to process?", "returns"],
    ["How long is the Plus free trial?", "plus"],
    ["How much does shipping cost?", "shipping"],
    ["The app crashes on Android 3.2.0", "app_troubleshooting"],
    ["Can I get a tracking number?", "shipping"],
    ["I want to cancel my Plus membership", "plus"],
  ];
  for (const [query, expectedSource] of cases) {
    const best = top(query)[0];
    assert.ok(best !== undefined, `no hits at all for: ${query}`);
    assert.ok(
      best.score >= POLICY_SCORE_THRESHOLD,
      `"${query}" scored ${best.score.toFixed(2)} on ${best.chunk.id}, below the threshold`,
    );
    assert.equal(best.chunk.source, expectedSource, `"${query}" retrieved the wrong document`);
  }
});

/**
 * Section-level precision is asserted only where the query carries the section's own
 * distinguishing vocabulary. "How long do I have to return something" reduces to the single
 * term `return`, which every section of returns.md shares — no keyword scorer can rank those
 * apart, and pretending otherwise in a test would encode a guarantee the design does not make.
 * `search_policy` returns the top 3, so the right section still reaches the agent.
 */
test("a query naming a section's own vocabulary retrieves that section first", () => {
  const cases: Array<[string, string]> = [
    ["return window", "policy:returns#return-window"],
    ["return processing times", "policy:returns#return-processing-times"],
    ["plus free trial", "policy:plus#free-trial"],
    ["shipping costs", "policy:shipping#shipping-costs"],
    ["delivery times", "policy:shipping#delivery-times-and-shipping-speed"],
  ];
  for (const [query, expectedId] of cases) {
    assert.equal(top(query)[0]?.chunk.id, expectedId, `"${query}" retrieved the wrong section`);
  }
});

test("the right section is within the top 3 even for an ambiguous phrasing", () => {
  const ids = top("How long do I have to return something?").map((h) => h.chunk.id);
  assert.ok(ids.includes("policy:returns#return-window"), `top 3 was ${ids.join(", ")}`);
});

test("AC-FAQ-03: off-corpus questions fall below the threshold", () => {
  const offCorpus = [
    "What is the capital of France?",
    "Who won the football last night?",
    "Write me a poem about penguins",
  ];
  for (const query of offCorpus) {
    const hits = top(query);
    const score = hits[0]?.score ?? 0;
    assert.ok(
      score < POLICY_SCORE_THRESHOLD,
      `"${query}" scored ${score.toFixed(2)} — the corpus should not be able to answer it`,
    );
  }
});

test("an unknown noun does not sink an otherwise answerable question", () => {
  // "laptop" appears nowhere in the corpus. It must be ignored, not counted as a miss —
  // otherwise every question about a specific product escalates.
  const best = top("Can I return a laptop?")[0];
  assert.ok(best !== undefined);
  assert.ok(best.score >= POLICY_SCORE_THRESHOLD);
  assert.equal(best.chunk.source, "returns");
});

test("headings outrank passing mentions", () => {
  // "refund" appears in returns#refunds as a heading and in several other sections as prose.
  assert.equal(top("refund")[0]?.chunk.id, "policy:returns#refunds");
});

test("tokenize drops stopwords and question words", () => {
  // Asserted as counts and collisions, not as literal stems — see the note below.
  assert.deepEqual(tokenize("What are the refunds?"), tokenize("refund"));
  assert.deepEqual(tokenize("A"), []);
  assert.deepEqual(tokenize("How long does it take?"), tokenize("take"));
  assert.equal(tokenize("What is the return window?").length, 2);
  // `ss` endings are not plurals.
  assert.deepEqual(tokenize("address"), ["address"]);
});

/**
 * The only property the stemmer must have: inflections of one word land on ONE token. The
 * output string itself is an implementation detail and is deliberately not asserted — what
 * broke in production was two spellings of the same word failing to meet.
 */
test("inflections of a word collide", () => {
  const same = (...words: string[]) => {
    const forms = words.map((w) => tokenize(w)[0]);
    assert.equal(new Set(forms).size, 1, `${words.join(" / ")} → ${forms.join(" / ")}`);
  };
  same("process", "processes", "processing", "processed");
  same("receive", "receives", "received");
  same("return", "returns", "returned");
  same("ship", "ships", "shipping", "shipped");
  same("cancel", "cancels", "cancelled");
  same("include", "includes", "including");
  same("policy", "policies");
  same("time", "times");
  same("day", "days");
});

test("scoring is deterministic across repeated calls", () => {
  const first = top("return window").map((h) => `${h.chunk.id}:${h.score.toFixed(6)}`);
  const second = top("return window").map((h) => `${h.chunk.id}:${h.score.toFixed(6)}`);
  assert.deepEqual(first, second);
});
