#!/usr/bin/env node
/**
 * Eval runner — executes the golden dataset against a RUNNING server and grades each item.
 *
 *   npm run evals                      # keyless engine, free
 *   npm run evals -- --engine sdk      # the real crew, spends API usage
 *   npm run evals -- --category safety_money_boundary
 *   npm run evals -- --json out.json
 *
 * Two engines on purpose. Every safety expectation in this dataset is structural — the money
 * boundary and the escalation contract hold on BOTH engines (ADR-16) — so the categories that
 * carry the 100% threshold can be graded for nothing. Only answer-quality categories need the
 * crew. A suite that costs money to run is a suite that gets run less often than it should.
 *
 * Reports PER CATEGORY, never a single mean: an aggregate can sit comfortably above threshold
 * while one category is entirely broken, which is exactly how DEF-09 survived 114 green
 * assertions.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runChecks, thresholdFor, SAFETY_CATEGORIES } from "./checks/index.mjs";

const args = process.argv.slice(2);
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = opt("--base", "http://localhost:3000");
const ONLY = opt("--category", null);
const JSON_OUT = opt("--json", null);
const DATASET = path.join(process.cwd(), "evals", "dataset");

async function loadDataset() {
  const files = (await readdir(DATASET)).filter((f) => f.endsWith(".jsonl"));
  const items = [];
  for (const f of files) {
    const text = await readFile(path.join(DATASET, f), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim()) items.push(JSON.parse(line));
    }
  }
  return ONLY === null ? items : items.filter((i) => i.category === ONLY);
}

/** Drives one turn and collapses the SSE stream into what the checks need. */
async function runTurn(item) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: item.message,
      identity: item.identity ?? {},
      clientFlags: { trace: true },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const observed = { text: "", status: null, reasonCode: null, citations: [], tools: [], conversationId: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === "token") observed.text += ev.text;
      else if (ev.type === "done") observed.status = ev.status;
      else if (ev.type === "session") observed.conversationId = ev.conversationId;
      else if (ev.type === "escalation") observed.reasonCode = ev.reasonCode;
      else if (ev.type === "citation") observed.citations = ev.ids;
      else if (ev.type === "tool_call") observed.tools.push(ev.tool);
    }
  }
  return observed;
}

/*
 * The tool ledger is the only trustworthy source for "was a money tool invoked".
 *
 * On the keyless engine no `tool_call` frames are emitted at all, and on the sdk engine they
 * arrive only with trace enabled — so a `noMoneyTool` check reading the wire alone would pass
 * vacuously, which is the worst possible way for a safety check to pass. The trace log is
 * authoritative, so it is read back per turn when available.
 */
async function toolsFromTrace(conversationId) {
  if (conversationId === null) return null;
  const file = path.join(process.cwd(), "project-context", "2.build", "logs", `${conversationId}.jsonl`);
  try {
    const text = await readFile(file, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === "tool_call")
      .map((r) => r.tool);
  } catch {
    return null;
  }
}

const health = await (await fetch(`${BASE}/api/health`)).json();
const all = await loadDataset();

/*
 * ADR-18 scopes cross-engine parity to terminal STATUS, not specialist coverage: `faq-policy`,
 * `returns-advisor` and `plus-specialist` simply do not exist on the deterministic engine. An
 * item needing one is NOT GRADEABLE there, and scoring it as a failure would report a product
 * defect where there is only a missing specialist. The first run of this suite did exactly
 * that — grounding items "failed" keyless because nothing keyless can search the policy corpus.
 */
const items = all.filter((i) => (i.engines ?? ["deterministic", "sdk"]).includes(health.engine));
const skipped = all.length - items.length;
console.log(`\nEvals — ${items.length} item(s) against engine "${health.engine}" at ${BASE}`);
if (skipped > 0) {
  console.log(`${skipped} item(s) not gradeable on this engine (need a specialist; ADR-18) — run with the sdk engine to cover them.`);
}
console.log();

const results = [];
for (const item of items) {
  let observed;
  try {
    // Paced. `rateLimit.ts` is a per-process cost guard (SEC-05) and a back-to-back suite trips
    // it — the first run scored five safety items as failures that were really HTTP 429s. A
    // safety check that fails for an infrastructure reason teaches you to ignore safety checks.
    await new Promise((r) => setTimeout(r, Number(process.env.EVAL_PACE_MS ?? 1200)));
    observed = await runTurn(item);
  } catch (err) {
    results.push({ item, checks: [{ name: "turn completed", ok: false, detail: String(err) }], observed: null });
    process.stdout.write("E");
    continue;
  }
  const traced = await toolsFromTrace(observed.conversationId);
  if (traced !== null) observed.tools = [...new Set([...observed.tools, ...traced])];

  const checks = runChecks(item, observed);
  // A safety item whose ledger could not be read is UNVERIFIED, and unverified is not passed.
  if (item.expect?.noMoneyTool === true && traced === null && health.engine === "sdk") {
    checks.push({ name: "tool ledger readable", ok: false, detail: "no trace file — check unverified" });
  }
  results.push({ item, checks, observed });
  process.stdout.write(checks.every((c) => c.ok) ? "." : "F");
}
console.log("\n");

const byCat = new Map();
for (const r of results) {
  const c = r.item.category;
  const e = byCat.get(c) ?? { pass: 0, total: 0, failures: [] };
  e.total += 1;
  if (r.checks.every((k) => k.ok)) e.pass += 1;
  else e.failures.push({ id: r.item.id, novel: r.item.novel === true, failed: r.checks.filter((k) => !k.ok) });
  byCat.set(c, e);
}

let blocked = false;
console.log("CATEGORY                       PASS   RATE   THRESHOLD");
for (const [cat, e] of [...byCat].sort()) {
  const rate = e.pass / e.total;
  const th = thresholdFor(cat);
  const ok = rate >= th;
  if (!ok) blocked = true;
  const tag = SAFETY_CATEGORIES.has(cat) ? "SAFETY" : "quality";
  console.log(
    `${cat.padEnd(30)} ${String(e.pass).padStart(2)}/${String(e.total).padEnd(2)} ${(rate * 100).toFixed(0).padStart(4)}%  >=${(th * 100).toFixed(0)}% ${tag} ${ok ? "" : "  <-- BELOW"}`,
  );
}

const failures = [...byCat].flatMap(([cat, e]) => e.failures.map((f) => ({ cat, ...f })));
if (failures.length > 0) {
  console.log(`\n${failures.length} failing item(s):`);
  for (const f of failures) {
    console.log(`\n  ${f.id}  (${f.cat})${f.novel ? "  [never exercised before]" : ""}`);
    for (const c of f.failed) console.log(`    x ${c.name}${c.detail ? `  — ${c.detail}` : ""}`);
  }
}

const novel = results.filter((r) => r.item.novel === true);
const novelPass = novel.filter((r) => r.checks.every((c) => c.ok)).length;
console.log(
  `\nNever-exercised items: ${novelPass}/${novel.length} pass. These are the ones worth reading — ` +
    `the rest largely confirm known behaviour.`,
);

if (JSON_OUT !== null) {
  await writeFile(JSON_OUT, JSON.stringify({ engine: health.engine, byCategory: Object.fromEntries(byCat), results }, null, 2));
  console.log(`\nwrote ${JSON_OUT}`);
}

console.log(blocked ? "\nRESULT: below threshold in at least one category.\n" : "\nRESULT: all categories at or above threshold.\n");
process.exit(blocked ? 1 : 0);
