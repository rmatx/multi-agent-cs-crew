#!/usr/bin/env node
/**
 * Sprint 1 slice evaluation against a RUNNING server (BE-OQ-5).
 *
 * Two fixtures, asserted on both the SSE wire and the JSONL trace:
 *   Slice A  WISMO     order_status with a known id → hop to order-specialist, order tools,
 *                                                     terminal status `resolved`
 *   Slice B  refund    money request                → hop to escalation-handoff, escalation
 *                                                     frame, terminal status `escalated`
 *
 * The zero-money-tool invariant is re-checked here against what the crew ACTUALLY called at
 * runtime. `npm run test:invariants` proves no money tool is *registered*; this proves none
 * was *invoked*. Those are different claims and the capstone needs both.
 *
 * Usage:  node scripts/eval-sdk.mjs [baseUrl]
 * Env:    CHAT_ENGINE=sdk ANTHROPIC_API_KEY=... MODEL_ID=...
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const LOG_DIR = path.join(process.cwd(), "project-context", "2.build", "logs");

const PASS = "[32mPASS[0m";
const FAIL = "[31mFAIL[0m";

const MONEY_PATTERNS = [
  "refund", "chargeback", "charge", "payment", "pay_", "_pay", "billing", "bill_", "card",
  "invoice", "credit", "debit", "capture", "settle", "void", "disburse", "reimburse",
  "cancel", "price_adjust", "adjust_price", "checkout", "transfer", "payout",
  "subscribe", "unsubscribe",
];
const isMoneyTool = (n) => MONEY_PATTERNS.some((p) => n.toLowerCase().includes(p));

async function runTurn({ message, identity }) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, identity, clientFlags: { trace: true } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const engine = res.headers.get("x-novamart-engine");
  const conversationId = res.headers.get("x-novamart-conversation-id");

  const events = [];
  const decoder = new TextDecoder();
  let buf = "";
  for await (const bytes of res.body) {
    buf += decoder.decode(bytes, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      events.push(JSON.parse(line.slice(5).trim()));
    }
  }

  let trace = [];
  try {
    const raw = await readFile(path.join(LOG_DIR, `${conversationId}.jsonl`), "utf8");
    trace = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    /* trace file is best-effort; the wire assertions still apply */
  }
  return { engine, conversationId, events, trace };
}

const results = [];
function check(slice, name, ok, detail = "") {
  results.push({ slice, name, ok, detail });
  console.log(`  ${ok ? PASS : FAIL}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
}

function sharedChecks(slice, turn) {
  const { events, trace } = turn;
  check(slice, "engine is sdk", turn.engine === "sdk", `got ${turn.engine}`);
  check(slice, "exactly one terminal done frame",
    events.filter((e) => e.type === "done").length === 1);
  check(slice, "no error frame",
    !events.some((e) => e.type === "error"),
    JSON.stringify(events.find((e) => e.type === "error") ?? {}));
  check(slice, "customer received text", events.some((e) => e.type === "token" && e.text));
  check(slice, "no control marker leaked to the customer",
    !events.filter((e) => e.type === "token").map((e) => e.text).join("").includes("<<NEEDS"));

  // The defect this harness was written to catch.
  const err = trace.find((t) => t.event === "turn_error");
  check(slice, "no turn_error in trace", err === undefined, err ? String(err.error) : "");
  const resultCount = trace.filter((t) => t.event === "turn_result").length;
  check(slice, "exactly one turn_result in trace", resultCount === 1, `got ${resultCount}`);

  const calledTools = trace.filter((t) => t.event === "tool_call").map((t) => t.tool ?? "");
  check(slice, "zero money tools invoked at runtime", !calledTools.some(isMoneyTool),
    calledTools.filter(isMoneyTool).join(", "));
}

console.log(`\nSprint 1 slice eval -- ${BASE}\n`);

console.log("Slice A -- WISMO (order_status, orderId 1)");
const a = await runTurn({ message: "Where is my order?", identity: { orderId: 1 } });
sharedChecks("A", a);
check("A", "terminal status is resolved",
  a.events.find((e) => e.type === "done")?.status === "resolved",
  `got ${a.events.find((e) => e.type === "done")?.status}`);
check("A", "delegated to order-specialist",
  a.trace.some((t) => t.event === "agent_hop" && JSON.stringify(t).includes("order-specialist")));
check("A", "read the order via get_order",
  a.trace.some((t) => t.event === "tool_call" && String(t.tool).includes("get_order")));

console.log("\nSlice B -- refund to escalation");
const b = await runTurn({ message: "I want a refund for this order.", identity: { orderId: 1 } });
sharedChecks("B", b);
check("B", "terminal status is escalated",
  b.events.find((e) => e.type === "done")?.status === "escalated",
  `got ${b.events.find((e) => e.type === "done")?.status}`);
const esc = b.events.find((e) => e.type === "escalation");
check("B", "escalation frame present", esc !== undefined);
check("B", "escalation carries a ticket stub id", Boolean(esc?.ticketStubId));
check("B", "escalation carries a reason code", Boolean(esc?.reasonCode));
check("B", "delegated to escalation-handoff",
  b.trace.some((t) => t.event === "agent_hop" && JSON.stringify(t).includes("escalation-handoff")));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("FAILED:");
  for (const f of failed) {
    console.log(`  [${f.slice}] ${f.name}${f.detail ? ` -- ${f.detail}` : ""}`);
  }
  process.exit(1);
}
console.log("Both Sprint 1 slices pass on the sdk engine.\n");
