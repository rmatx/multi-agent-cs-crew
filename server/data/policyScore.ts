/**
 * Policy chunking and section/keyword scoring — ADR-11, PRD AC-FAQ-01 / AC-FAQ-05.
 *
 * THIS MODULE HAS NO IMPORTS, ON PURPOSE — same reasoning as `toolRegistry.ts` and
 * `moneyIntent.ts`: it carries the grounding threshold that decides whether the crew answers
 * or escalates, so it must be unit-testable under `node --test` type stripping without
 * dragging in Next, DuckDB, or the filesystem. `policy.ts` does the file I/O and calls in here.
 *
 * WHY NO VECTOR DB (AC-FAQ-05): the corpus is four hand-authored files. Section/keyword
 * scoring with inverse document frequency is explainable — an operator can read a trace and
 * see WHICH terms carried a score — and it degrades honestly: an unknown word contributes
 * nothing rather than being embedded near something plausible.
 */

/**
 * Grounding threshold (ADR-11, AC-FAQ-01). At or above this, the crew may answer from the
 * chunk; below it, `search_policy` returns NO text at all and the coordinator escalates with
 * `reason_code=ungrounded`. The number is normative — do not tune it to make a demo pass.
 */
export const POLICY_SCORE_THRESHOLD = 0.55;

/**
 * Body matches score slightly below heading matches: a section titled for the question is a
 * better hit than one that merely mentions its words in passing.
 *
 * The document `#` title counts as BODY, not heading. Folding it into the heading was a real
 * retrieval bug: every section of returns.md inherited "returns" from the document title, so
 * a one-word query scored a perfect 1.00 on all six sections at once and the ranking fell
 * back to alphabetical order. A title tells you which file you are in; only the `##` heading
 * tells you which question the section answers.
 */
const HEADING_WEIGHT = 1;
const BODY_WEIGHT = 0.8;

/**
 * Suffix normalization: `-ies`, plural, `-ing`, `-ed`, trailing `-e`, trailing `-y`.
 *
 * Not a real stemmer. The job is only to make a query term collide with the corpus term it
 * obviously means, and the ONLY property that matters is that both sides normalize to the
 * same string. An earlier version failed exactly there, and quietly: `received` became
 * `receiv` while `receives` became `receive`, and `processing` became `proces` while
 * `process` stayed `process`. Live turns then escalated questions the corpus answers word for
 * word, because the words never met. Every rule below is written to be order-independent
 * across inflections of one word, and the tests assert the collisions, not the outputs.
 */
function stem(word: string): string {
  let out = word;

  if (out.length > 4 && out.endsWith("ies")) out = `${out.slice(0, -3)}i`;
  else if (out.length > 3 && out.endsWith("s") && !out.endsWith("ss")) out = out.slice(0, -1);

  if (out.length >= 6 && out.endsWith("ing")) out = out.slice(0, -3);
  else if (out.length >= 5 && out.endsWith("ed")) out = out.slice(0, -2);

  // Undouble a final consonant ("shipp" → "ship", "cancell" → "cancel"), but never s or z:
  // `process` legitimately ends in `ss`, and collapsing it creates collisions rather than
  // preventing them. `ll` IS collapsed — British doubling ("cancelled", "travelled") is
  // common in this corpus's vocabulary and a false merge there is not.
  const last = out.at(-1) ?? "";
  if (out.length > 3 && last === out.at(-2) && !"aeiousz".includes(last)) out = out.slice(0, -1);

  // Canonical form drops a trailing `e` and folds `y` to `i`, so receive/received/receives and
  // policy/policies land on one token.
  if (out.length > 3 && out.endsWith("e")) out = out.slice(0, -1);
  if (out.length > 3 && out.endsWith("y")) out = `${out.slice(0, -1)}i`;

  return out;
}

/**
 * Words carrying no retrieval signal, stored in STEMMED form because the stopword check runs
 * after stemming — otherwise "needs" survives a list that contains "need".
 *
 * Three groups: function words, interrogatives, and prepositions. The interrogatives are not
 * optional politeness: leaving them in was a real grounding hole, where "What is the capital
 * of France" matched a heading beginning "What" on its only in-vocabulary term and scored a
 * perfect 1.00. A question word must never be the evidence that the corpus can answer
 * something. Prepositions are here because they dilute a coverage ratio without ever
 * discriminating between two sections of the same document.
 */
const STOPWORDS = new Set(
  [
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had",
    "has", "have", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on", "or", "that",
    "the", "their", "them", "there", "they", "this", "to", "was", "were", "with", "you",
    "your",
    "what", "when", "where", "which", "who", "whose", "why", "how", "can", "could", "did",
    "do", "does", "may", "might", "must", "need", "should", "want", "will", "would", "get",
    "got", "about", "any", "all", "some", "much", "many", "long", "still", "please", "tell",
    "after", "before", "during", "until", "since", "into", "over", "under", "again",
    "between", "then", "than",
  ].map(stem),
);

export type PolicyChunk = {
  /** Stable citation id: `policy:<source>#<section-slug>`. */
  readonly id: string;
  /** File name without extension, e.g. `returns`. */
  readonly source: string;
  /** Document `#` title. */
  readonly title: string;
  /** Section `##` heading. */
  readonly heading: string;
  readonly text: string;
};

export type ScoredChunk = {
  readonly chunk: PolicyChunk;
  readonly score: number;
  /** Query terms that actually matched, for the operator trace (AC-FAQ-02). */
  readonly matched: readonly string[];
  /** Share of the section heading's own terms the query covers — the tie-break. */
  readonly headingCoverage: number;
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Lowercase word tokens: punctuation stripped, suffixes normalized, stopwords dropped.
 */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9][a-z0-9.]*/g) ?? [];
  const out: string[] = [];
  for (const word of raw) {
    const trimmed = word.replace(/\.+$/, "");
    if (trimmed.length < 2) continue;
    const stemmed = stem(trimmed);
    if (STOPWORDS.has(stemmed)) continue;
    out.push(stemmed);
  }
  return out;
}

/**
 * Split one policy markdown file into `##` sections. The `#` title is carried onto every
 * chunk so a section heading like "Refunds" still knows it belongs to Returns.
 */
export function chunkMarkdown(source: string, markdown: string): PolicyChunk[] {
  const lines = markdown.split("\n");
  const chunks: PolicyChunk[] = [];

  let title = source;
  let heading: string | null = null;
  let body: string[] = [];

  const flush = (): void => {
    if (heading === null) return;
    const text = body.join("\n").trim();
    if (text.length > 0) {
      chunks.push({
        id: `policy:${source}#${slugify(heading)}`,
        source,
        title,
        heading,
        text,
      });
    }
    body = [];
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      heading = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("# ")) {
      flush();
      title = line.slice(2).trim();
      heading = null;
      continue;
    }
    body.push(line);
  }
  flush();

  return chunks;
}

/**
 * Inverse document frequency over the chunk set. Rare terms ("trial", "chargeback") carry
 * more weight than terms that appear in every file ("order", "agent").
 */
function buildIdf(chunks: readonly PolicyChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const seen = new Set(tokenize(`${chunk.title} ${chunk.heading} ${chunk.text}`));
    for (const term of seen) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  const total = chunks.length;
  for (const [term, count] of df) idf.set(term, Math.log(1 + total / count));
  return idf;
}

/**
 * How many query terms carry the score. Sentence-shaped queries dilute a coverage ratio, and
 * an agent writes sentences.
 *
 * Measured on live turns: "return processing timeline after item received" scored 0.504 on
 * the section literally headed "Return processing times", and "Plus membership benefits what
 * does Plus include" scored 0.5264 on "What Plus membership includes". Both are correct
 * retrievals pushed under the 0.55 gate by trailing words that happen to exist elsewhere in
 * the corpus. Every extra word of paraphrase made the right answer look worse.
 *
 * The threshold is normative (ADR-11 / AC-FAQ-01) and is not the thing to move. What moves is
 * WHICH terms are asked to carry the judgement: the most informative ones. Keeping the four
 * highest-idf terms is ordinary term selection, and it does not weaken the grounding gate —
 * an off-corpus question still has NO terms in the vocabulary, so it still scores nothing.
 */
const MAX_QUERY_TERMS = 4;

function selectQueryTerms(known: readonly string[], idf: Map<string, number>): string[] {
  if (known.length <= MAX_QUERY_TERMS) return [...known];
  return [...known]
    // Alphabetical secondary key so a tie in idf resolves the same way on every run.
    .sort((a, b) => (idf.get(b) ?? 0) - (idf.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, MAX_QUERY_TERMS);
}

/**
 * Score every chunk against the query and return the best `topK`, highest first.
 *
 * The score is the share of the query's RETRIEVABLE information the chunk covers:
 *
 *     score(c) = Σ idf(t)·w(t,c) for matched t   ÷   Σ idf(t) for t known to the corpus
 *
 * Two properties matter for grounding, and both are tested:
 *
 * 1. **Unknown words are excluded from the denominator, not counted against the chunk.**
 *    "Can I return a laptop?" must not fail merely because the corpus never says "laptop" —
 *    an out-of-vocabulary term carries no retrieval signal either way. What it MUST NOT do
 *    is invent one, so it is dropped rather than fuzzily matched.
 * 2. **A query with no corpus vocabulary at all scores 0.** "What is the capital of France"
 *    has nothing to retrieve, so it falls below the threshold and escalates. That is
 *    AC-FAQ-03 holding structurally rather than by prompt instruction.
 */
export function scoreChunks(
  query: string,
  chunks: readonly PolicyChunk[],
  topK: number,
): ScoredChunk[] {
  if (chunks.length === 0) return [];

  const idf = buildIdf(chunks);
  const queryTerms = [...new Set(tokenize(query))];
  const known = selectQueryTerms(
    queryTerms.filter((term) => idf.has(term)),
    idf,
  );
  const denominator = known.reduce((sum, term) => sum + (idf.get(term) ?? 0), 0);
  if (denominator === 0) return [];

  const scored: ScoredChunk[] = chunks.map((chunk) => {
    const headingTerms = new Set(tokenize(chunk.heading));
    const bodyTerms = new Set(tokenize(`${chunk.title} ${chunk.text}`));
    const matched: string[] = [];
    let numerator = 0;

    for (const term of known) {
      const weight = headingTerms.has(term)
        ? HEADING_WEIGHT
        : bodyTerms.has(term)
          ? BODY_WEIGHT
          : 0;
      if (weight === 0) continue;
      matched.push(term);
      numerator += (idf.get(term) ?? 0) * weight;
    }

    const matchedInHeading = matched.filter((term) => headingTerms.has(term)).length;
    const headingCoverage = headingTerms.size === 0 ? 0 : matchedInHeading / headingTerms.size;

    return { chunk, score: numerator / denominator, matched, headingCoverage };
  });

  /**
   * Ranking: score, then heading coverage, then id.
   *
   * The middle key matters more than it looks. A one-word query like "return" matches the
   * heading of four different sections of returns.md and scores a perfect 1.00 on every one
   * of them — the ratio genuinely cannot separate them. Heading coverage breaks that tie the
   * way a person would: "Return window" is two-thirds query, "Items that cannot be returned"
   * is one-third, so the section that is MOSTLY about the asked-for thing wins over the one
   * that merely mentions it in its title.
   *
   * Id is the final key so ranking is stable across runs and machines, and a remaining tie is
   * an honest statement that the scorer cannot choose — which is why `search_policy` hands
   * the agent the top few sections rather than a single winner.
   */
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.headingCoverage !== a.headingCoverage) return b.headingCoverage - a.headingCoverage;
      return a.chunk.id.localeCompare(b.chunk.id);
    })
    .slice(0, Math.max(1, topK));
}
