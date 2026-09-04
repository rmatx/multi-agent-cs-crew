#!/usr/bin/env node
/**
 * Error rate, latency and cost, read back out of the trace logs.
 *
 * The runtime already writes everything this needs — one redacted JSONL file per conversation
 * under `project-context/2.build/logs/` — so this adds no instrumentation and no dependency.
 * It is a reader. That also means it works on logs written before it existed, which is the
 * point: the baseline is historical, not "starting today".
 *
 * Scope: the `sdk` engine. The deterministic engine writes no trace at all — it makes no model
 * call, costs nothing and answers in single-digit milliseconds, so there is no rate, latency
 * or spend to attribute. If that ever stops being true, this script will silently report
 * nothing rather than wrongly report zero, so instrument the engine first.
 *
 *   node scripts/observability.mjs
 *   node scripts/observability.mjs --since 2026-09-01
 *   node scripts/observability.mjs --json
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "project-context", "2.build", "logs");

/** Events that mean something went wrong, whether or not the turn survived them. */
const FAULT_EVENTS = new Set([
  "turn_error",
  "tool_denied",
  "tool_retry",
  "escalation_rejected",
  "forced_escalation_failed",
  "hop_budget_exhausted",
  "external_lookup_degraded",
  "needs_input_inferred",
]);

function parseArgs(argv) {
  const args = { json: false, since: null, dir: LOG_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--since") args.since = argv[++i] ?? null;
    else if (argv[i] === "--dir") args.dir = argv[++i] ?? LOG_DIR;
  }
  return args;
}

const ms = (a, b) => new Date(b).getTime() - new Date(a).getTime();

/**
 * Nearest-rank percentile. Deliberately not interpolated: with the double-digit turn counts
 * this reads, an interpolated p95 invents a number that no turn actually took.
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? null,
    total: sorted.reduce((a, b) => a + b, 0),
  };
}

/**
 * One conversation file → its turns and faults.
 *
 * `durationMs` is read from the record when present and derived from the preceding
 * `prompt_trace` when not, so logs written before the field existed still report latency.
 * Derived values are counted separately — they include queueing ahead of the model call and
 * are not the same measurement, and a mixed percentile that hides which is which is worse
 * than one that admits it.
 */
function readConversation(text) {
  const turns = [];
  const faults = [];
  const toolDurations = new Map();
  let pendingStart = null;

  // turnId → prompt_trace ts. Records written before turnId shipped fall back to `pendingStart`,
  // the positional pairing this replaces: it assumes the next turn_result belongs to the last
  // prompt_trace, which is true only while turns of one conversation never overlap.
  const startsByTurn = new Map();

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // A partially-flushed last line is expected; it is not a data error.
    }

    if (rec.event === "prompt_trace") {
      pendingStart = rec.ts;
      if (rec.turnId) startsByTurn.set(rec.turnId, rec.ts);
    }

    if (rec.event === "tool_result" && typeof rec.durationMs === "number") {
      const list = toolDurations.get(rec.tool) ?? [];
      list.push({ ts: rec.ts, durationMs: rec.durationMs });
      toolDurations.set(rec.tool, list);
    }

    if (FAULT_EVENTS.has(rec.event)) {
      faults.push({ event: rec.event, ts: rec.ts, tool: rec.tool ?? null, reason: rec.reason ?? null });
    }

    if (rec.event === "turn_result" || rec.event === "turn_error") {
      const startTs = (rec.turnId && startsByTurn.get(rec.turnId)) ?? pendingStart;
      const derived = startTs ? ms(startTs, rec.ts) : null;
      const measured = typeof rec.durationMs === "number" ? rec.durationMs : null;
      turns.push({
        ts: rec.ts,
        turnId: rec.turnId ?? null,
        correlated: Boolean(rec.turnId),
        ok: rec.event === "turn_result" && rec.subtype === "success",
        failed: rec.event === "turn_error" || (rec.event === "turn_result" && rec.subtype !== "success"),
        subtype: rec.event === "turn_error" ? "exception" : (rec.subtype ?? "unknown"),
        costUsd: typeof rec.costUsd === "number" ? rec.costUsd : null,
        durationMs: measured ?? derived,
        durationDerived: measured === null && derived !== null,
        hops: typeof rec.hops === "number" ? rec.hops : null,
        path: Array.isArray(rec.path) ? rec.path.join(" → ") : null,
        usage: rec.usage ?? null,
      });
      pendingStart = null;
    }
  }

  return { turns, faults, toolDurations };
}

function tokensFrom(usage) {
  if (!usage || typeof usage !== "object") return null;
  const num = (v) => (typeof v === "number" ? v : 0);
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const cacheWrite = num(usage.cache_creation_input_tokens);
  // All four redacted (pre-fix logs) reads as no usage data rather than as a genuine zero.
  if (input + output + cacheRead + cacheWrite === 0) return null;
  return { input, output, cacheRead, cacheWrite };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let files;
  try {
    files = (await readdir(args.dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    console.error(`No trace directory at ${args.dir}. Run a turn on the sdk engine first.`);
    process.exit(1);
  }

  const turns = [];
  const faults = [];
  const toolDurations = new Map();

  for (const file of files) {
    const parsed = readConversation(await readFile(path.join(args.dir, file), "utf8"));
    for (const t of parsed.turns) {
      if (args.since && t.ts < args.since) continue;
      turns.push({ ...t, conversation: file.replace(/\.jsonl$/, "") });
    }
    for (const f of parsed.faults) {
      if (args.since && f.ts < args.since) continue;
      faults.push(f);
    }
    for (const [tool, list] of parsed.toolDurations) {
      // Honour --since here too: a tool table covering all history beside a one-day turn
      // window reads as if those calls belonged to the window.
      const inWindow = args.since ? list.filter((c) => c.ts >= args.since) : list;
      if (inWindow.length === 0) continue;
      toolDurations.set(tool, [...(toolDurations.get(tool) ?? []), ...inWindow.map((c) => c.durationMs)]);
    }
  }

  if (turns.length === 0) {
    console.error(
      `No sdk turns found in ${files.length} log file(s)` +
        (args.since ? ` since ${args.since}` : "") +
        ". The deterministic engine does not write traces.",
    );
    process.exit(1);
  }

  const failed = turns.filter((t) => t.failed);
  const latency = summarise(turns.filter((t) => t.durationMs !== null).map((t) => t.durationMs));
  const cost = summarise(turns.filter((t) => t.costUsd !== null).map((t) => t.costUsd));
  const derivedCount = turns.filter((t) => t.durationDerived).length;
  const withTokens = turns.map((t) => tokensFrom(t.usage)).filter(Boolean);

  const byPath = new Map();
  for (const t of turns) {
    const key = t.path || "(no path recorded)";
    const entry = byPath.get(key) ?? { n: 0, cost: 0, durations: [] };
    entry.n += 1;
    entry.cost += t.costUsd ?? 0;
    if (t.durationMs !== null) entry.durations.push(t.durationMs);
    byPath.set(key, entry);
  }

  const faultCounts = [...faults.reduce((m, f) => m.set(f.event, (m.get(f.event) ?? 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1]);

  // Run rate, by calendar day. The doc-standard "minimum dashboard" metric this was missing:
  // error rate and latency say how well turns went, run rate says whether anyone ran any.
  const byDay = new Map();
  for (const t of turns) {
    const day = String(t.ts).slice(0, 10);
    const e = byDay.get(day) ?? { turns: 0, failed: 0, cost: 0 };
    e.turns += 1;
    if (t.failed) e.failed += 1;
    e.cost += t.costUsd ?? 0;
    byDay.set(day, e);
  }
  const days = [...byDay].sort((a, b) => a[0].localeCompare(b[0]));

  const report = {
    window: { since: args.since, conversations: files.length, turns: turns.length },
    correlation: {
      withTurnId: turns.filter((t) => t.correlated).length,
      positional: turns.filter((t) => !t.correlated).length,
    },
    runRate: Object.fromEntries(days.map(([d, v]) => [d, v])),
    errorRate: { failedTurns: failed.length, totalTurns: turns.length, rate: failed.length / turns.length },
    latencyMs: latency,
    costUsd: cost,
    faults: Object.fromEntries(faultCounts),
    byPath: Object.fromEntries(
      [...byPath].map(([k, v]) => [k, { turns: v.n, costUsd: v.cost, p95Ms: percentile([...v.durations].sort((a, b) => a - b), 95) }]),
    ),
    tools: Object.fromEntries(
      [...toolDurations].map(([k, v]) => [k, summarise(v)]).sort((a, b) => (b[1].p95 ?? 0) - (a[1].p95 ?? 0)),
    ),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const usd = (n) => (n === null ? "—" : `$${n.toFixed(4)}`);
  const secs = (n) => (n === null ? "—" : `${(n / 1000).toFixed(1)}s`);
  const pct = (n) => `${(n * 100).toFixed(1)}%`;

  console.log(`\nNovaMart — sdk engine observability`);
  console.log(`${turns.length} turns across ${files.length} conversation log(s)${args.since ? ` since ${args.since}` : ""}`);
  const positional = report.correlation.positional;
  if (positional > 0) {
    console.log(`${positional} turn(s) correlated positionally — written before turnId shipped.`);
  }
  console.log();

  console.log(`ERROR RATE   ${pct(report.errorRate.rate)}  (${failed.length}/${turns.length} turns failed)`);
  if (faultCounts.length > 0) {
    for (const [event, n] of faultCounts) console.log(`  ${String(n).padStart(4)}  ${event}`);
  } else {
    console.log(`     no fault events recorded`);
  }

  console.log(`\nLATENCY      p50 ${secs(latency.p50)}   p95 ${secs(latency.p95)}   max ${secs(latency.max)}`);
  if (derivedCount > 0) {
    console.log(`  ${derivedCount}/${turns.length} derived from prompt_trace→turn_result (pre-instrumentation logs);`);
    console.log(`  those include queueing ahead of the model call, so they read slightly high.`);
  }

  console.log(`\nCOST         total ${usd(cost.total)}   mean ${usd(cost.total / (cost.n || 1))}   p95 ${usd(cost.p95)}`);
  if (withTokens.length === 0) {
    console.log(`  No token usage recorded. Logs written before the redaction fix stored every`);
    console.log(`  *_tokens field as [REDACTED], so spend cannot be attributed for those turns.`);
  } else {
    const sum = withTokens.reduce(
      (a, t) => ({ input: a.input + t.input, output: a.output + t.output, cacheRead: a.cacheRead + t.cacheRead, cacheWrite: a.cacheWrite + t.cacheWrite }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
    const cacheable = sum.cacheRead + sum.cacheWrite;
    console.log(`  tokens over ${withTokens.length} turn(s): in ${sum.input}  out ${sum.output}  cache read ${sum.cacheRead}  cache write ${sum.cacheWrite}`);
    if (cacheable > 0) console.log(`  cache hit ratio ${pct(sum.cacheRead / cacheable)} of cacheable input`);
  }

  console.log(`\nRUN RATE`);
  const busiest = Math.max(...days.map(([, v]) => v.turns), 1);
  for (const [day, v] of days.slice(-14)) {
    const bar = "\u2588".repeat(Math.max(1, Math.round((v.turns / busiest) * 24)));
    const flag = v.failed > 0 ? `  ${v.failed} failed` : "";
    console.log(`  ${day}  ${String(v.turns).padStart(4)} turns  ${usd(v.cost).padStart(9)}  ${bar}${flag}`);
  }
  if (days.length > 14) console.log(`  (${days.length - 14} earlier day(s) not shown)`);

  console.log(`\nBY AGENT PATH`);
  for (const [p, v] of Object.entries(report.byPath).sort((a, b) => b[1].costUsd - a[1].costUsd)) {
    console.log(`  ${p.padEnd(34)} ${String(v.turns).padStart(3)} turns  ${usd(v.costUsd).padStart(10)}  p95 ${secs(v.p95Ms)}`);
  }

  const tools = Object.entries(report.tools);
  if (tools.length > 0) {
    console.log(`\nTOOL LATENCY`);
    for (const [tool, s] of tools) {
      console.log(`  ${tool.padEnd(40)} ${String(s.n).padStart(4)} calls  p50 ${s.p50}ms  p95 ${s.p95}ms  max ${s.max}ms`);
    }
  }
  console.log();
}

await main();
