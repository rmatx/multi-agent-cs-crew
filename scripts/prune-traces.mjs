#!/usr/bin/env node
/**
 * Enforce the trace-log retention window (SEC-03).
 *
 * The runtime prunes once per process on the first tracer it creates, which covers a laptop that
 * gets restarted. A long-lived host is the case that needs this: a process running for weeks
 * would prune on day one and never again. Run it from cron, or by hand before handing a machine
 * to anyone.
 *
 *   npm run prune:traces              # honour TRACE_RETENTION_DAYS, default 7
 *   npm run prune:traces -- --days 0  # keep nothing older than today
 *   npm run prune:traces -- --dry-run
 *
 * Deliberately duplicates no logic: it calls the same `pruneOldTraces` the runtime uses, so the
 * window cannot drift between the scheduled sweep and the in-process one.
 */

import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { pruneOldTraces, resolveRetentionDays } from "../server/runtime/trace.ts";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const daysArg = argv.indexOf("--days");
const days = daysArg >= 0 ? Number(argv[daysArg + 1]) : resolveRetentionDays();

if (!Number.isFinite(days) || days < 0) {
  console.error(`--days must be a non-negative number, got ${argv[daysArg + 1]}`);
  process.exit(1);
}

const dir = path.join(process.cwd(), "project-context", "2.build", "logs");

if (dryRun) {
  const cutoff = Date.now() - days * 86_400_000;
  let stale = 0;
  let kept = 0;
  try {
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const info = await stat(path.join(dir, file));
      if (info.mtimeMs < cutoff) {
        stale += 1;
        console.log(`would remove  ${file}  (${new Date(info.mtimeMs).toISOString().slice(0, 10)})`);
      } else {
        kept += 1;
      }
    }
  } catch {
    console.log(`no trace directory at ${dir}`);
    process.exit(0);
  }
  console.log(`\ndry run: ${stale} file(s) older than ${days} day(s) would be removed, ${kept} kept.`);
  process.exit(0);
}

const { removed, kept } = await pruneOldTraces(days, dir);
console.log(`retention ${days} day(s): removed ${removed} trace file(s), kept ${kept}.`);
