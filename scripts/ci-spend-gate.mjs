#!/usr/bin/env node
/**
 * Spend gate + run report for the live-eval workflow (DEP-OQ-4).
 *
 * Reads the observability report for the run, writes a GitHub job summary, and exits non-zero
 * if the run cost more than its budget. Lives in a file rather than inline in the YAML because
 * a `node -e` string nested inside single-quoted YAML inside a shell step is three levels of
 * quoting and cannot be run locally — which is how the first version of this shipped with a
 * broken template literal that no test could have caught.
 *
 *   node scripts/ci-spend-gate.mjs <report.json> <budgetUsd>
 *
 * Exit codes: 0 within budget · 1 over budget or unreadable report.
 */

import { appendFileSync, readFileSync } from "node:fs";

const [, , reportPath, budgetArg] = process.argv;

if (!reportPath) {
  console.error("usage: ci-spend-gate.mjs <report.json> <budgetUsd>");
  process.exit(1);
}

const budget = Number(budgetArg ?? "0");
if (!Number.isFinite(budget) || budget <= 0) {
  console.error(`::error::budget must be a positive number, got ${budgetArg}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (err) {
  console.error(`::error::could not read the observability report: ${String(err)}`);
  process.exit(1);
}

const secs = (msValue) => (msValue === null || msValue === undefined ? "—" : `${(msValue / 1000).toFixed(1)}s`);
const cost = report.costUsd?.total ?? 0;
const rate = report.errorRate ?? { rate: 0, failedTurns: 0, totalTurns: 0 };

const lines = [
  "## Live crew eval",
  "",
  "| Metric | Value |",
  "| --- | --- |",
  `| Turns | ${report.window?.turns ?? 0} |`,
  `| Error rate | ${(rate.rate * 100).toFixed(1)}% (${rate.failedTurns}/${rate.totalTurns}) |`,
  `| Latency p50 / p95 | ${secs(report.latencyMs?.p50)} / ${secs(report.latencyMs?.p95)} |`,
  `| Time to first token p95 | ${secs(report.ttftMs?.p95)} |`,
  `| Cost | $${cost.toFixed(4)} of $${budget.toFixed(2)} budget |`,
  `| Model | ${process.env.MODEL_ID ?? "unset"} |`,
  "",
];

const faults = Object.entries(report.faults ?? {});
if (faults.length > 0) {
  lines.push("### Fault events", "");
  for (const [event, n] of faults) lines.push(`- ${n} x \`${event}\``);
  lines.push("");
}

const paths = Object.entries(report.byPath ?? {});
if (paths.length > 0) {
  lines.push("### Cost by agent path", "", "| Path | Turns | Cost |", "| --- | ---: | ---: |");
  for (const [name, v] of paths.sort((a, b) => b[1].costUsd - a[1].costUsd)) {
    lines.push(`| ${name} | ${v.turns} | $${v.costUsd.toFixed(4)} |`);
  }
  lines.push("");
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  appendFileSync(summaryPath, lines.join("\n"));
} else {
  console.log(lines.join("\n"));
}

if (cost > budget) {
  console.error(`::error::spend cap exceeded: $${cost.toFixed(4)} > $${budget.toFixed(2)}`);
  process.exit(1);
}

console.log(`spend $${cost.toFixed(4)} within $${budget.toFixed(2)} budget`);
