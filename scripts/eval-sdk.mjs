#!/usr/bin/env node
/**
 * F-EVAL-01 evaluation against a RUNNING server (BE-OQ-5).
 *
 * EIGHT scripts, one per registered path, asserted on both the SSE wire and the JSONL trace.
 * Slices A-C are the Sprint 1 set; D-H cover the agents added in Sprint 2. Every fixture
 * pins `AS_OF_DATE` through the server it runs against (see USAGE) — AC-EVAL-05 — because
 * with asOf defaulting to today the shift grows a day per day and absolute expectations rot.
 *
 * The scripts and what each one exists to prove:
 *   Slice A  WISMO       order_status with a known id → order-specialist, order tools,
 *                                                       terminal status `resolved`
 *   Slice B  refund      money request               → escalation-handoff, escalation frame,
 *                                                       `escalated`, reason payment_or_refund
 *   Slice C  return      return status on a returned → the external holiday calendar is
 *                        order                         actually invoked; no invented timeline
 *   Slice D  faq         policy question in corpus  → faq-policy, search_policy above the
 *                                                       0.55 gate, a citation in the reply
 *   Slice E  ungrounded  question the corpus cannot → faq-policy reports not-covered, then
 *                        answer                        escalation with reason `ungrounded`
 *   Slice F  plus        membership status          → plus-specialist, get_membership, and
 *                                                       the DemoOverlay persona is used
 *   Slice G  returns     eligibility on an old order→ returns-advisor answers order AND
 *                                                       policy in ONE hop (chain exception)
 *   Slice H  restricted  cancel a membership        → escalation with `restricted_action`,
 *                                                       and no money tool anywhere
 *
 * Slice G is the hop-accounting assertion, not just a returns test: the SAD chain exception
 * says returns-advisor reuses the order tools itself rather than costing a second hop, and
 * `hops === 1` is the only way to prove that held. Slice E is the grounding assertion — the
 * one that fails loudest if the 0.55 threshold is ever tuned to make a demo pass.
 *
 * Slice C exists because the calendar tool first shipped unreachable: its gate keyed on
 * undelivered orders, and every order in the fixture is terminal (completed / cancelled /
 * returned). A tool nothing can call passes every unit test it has. The fixture is worded as
 * return STATUS, not refund timing, on purpose — the coordinator routes any refund ask
 * straight to a human, so a refund-worded question never reaches a specialist at all. Order
 * 45662 is `returned` and its owner is in `US`.
 *
 * The zero-money-tool invariant is re-checked here against what the crew ACTUALLY called at
 * runtime. `npm run test:invariants` proves no money tool is *registered*; this proves none
 * was *invoked*. Those are different claims and the capstone needs both.
 *
 * USAGE. Start the server with a pinned clock, then run this:
 *   CHAT_ENGINE=sdk AS_OF_DATE=2026-09-01 npm run dev
 *   npm run eval:sdk
 *
 * Env on the SERVER: CHAT_ENGINE=sdk ANTHROPIC_API_KEY=... MODEL_ID=... AS_OF_DATE=...
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
/**
 * Fixture ids, chosen from REAL rows and pinned here so a failure names a data change rather
 * than a mystery. Verified against `data/fixtures/novamart_ci.duckdb`.
 */
/** `returned`, owner in US so the holiday API resolves. */
const RETURNED_ORDER_ID = 45662;
/** Placed on the order anchor, so it is "today" at any asOf — always inside the 14-day window. */
const RECENT_ORDER_ID = 46101;
/**
 * Placed 2024-01-02: roughly a year before the anchor, so always outside the window. Not used
 * by a slice — it escalates for a human exception, which is correct behaviour and therefore
 * cannot assert the one-hop rule. Kept for the manual walkthrough in README.
 */
export const OLD_ORDER_ID = 1;
/** Real membership row: plus_monthly, active, open-ended. */
const PAID_PLUS_USER_ID = 38;
/** The one DemoOverlay persona (data/demo_overlay.json) — a live trial, which no real row has. */
const TRIAL_OVERLAY_USER_ID = 45344;
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

console.log(`\nF-EVAL-01 crew eval -- ${BASE}\n`);

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

console.log("\nSlice C -- return processing (exercises the external holiday calendar)");
const c = await runTurn({
  message: "I sent this order back. Where does my return stand?",
  identity: { orderId: RETURNED_ORDER_ID },
});
sharedChecks("C", c);
const calendarCalls = c.trace.filter(
  (t) => t.event === "tool_call" && String(t.tool).includes("get_processing_calendar"),
);
check("C", "the external calendar tool was actually invoked", calendarCalls.length > 0,
  "gate never fired -- the tool is unreachable again");
const calendarResult = c.trace.find(
  (t) => t.event === "tool_result" && String(t.tool).includes("get_processing_calendar"),
);
// The contract is "degrade, never throw": whether the third party answered or not, the tool
// must come back ok and the turn must still resolve. Only an isError frame is a failure.
check("C", "the calendar returned without erroring", calendarResult?.ok !== false,
  JSON.stringify(calendarResult?.response ?? {}).slice(0, 200));
// Either terminal status is legitimate here: the specialist can report where the return
// stands, and handing a return to a human is also a defensible call. What must NOT happen is
// the turn dying on the external dependency, which the shared checks already cover.
const cStatus = c.events.find((e) => e.type === "done")?.status;
check("C", "terminal status is resolved or escalated, never an error",
  cStatus === "resolved" || cStatus === "escalated", `got ${cStatus}`);
const cText = c.events.filter((e) => e.type === "token").map((e) => e.text).join("");
// A holiday is context, never a promise. This is the fabrication the tool most invites.
check("C", "no fabricated refund timeline", !/\b(within|in)\s+\d+[-\s]?(business\s+)?days?\b/i.test(cText),
  cText.slice(0, 200));
// The dedupe fix: upstream lists Columbus Day twice (regional + nationwide).
const calText = JSON.stringify(calendarResult?.response ?? {});
const holidayNames = [...calText.matchAll(/"name":"([^"]+)"/g)].map((m) => m[1]);
check("C", "no duplicate holiday reached the model",
  new Set(holidayNames).size === holidayNames.length, holidayNames.join(", "));

console.log("\nSlice D -- grounded policy answer (faq-policy)");
const d = await runTurn({ message: "How long is the NovaMart Plus free trial?" });
sharedChecks("D", d);
check("D", "delegated to faq-policy",
  d.trace.some((t) => t.event === "agent_hop" && JSON.stringify(t).includes("faq-policy")));
const dSearch = d.trace.filter((t) => t.event === "policy_search");
check("D", "search_policy ran", dSearch.length > 0);
check("D", "a section cleared the 0.55 grounding gate",
  dSearch.some((t) => t.grounded === true),
  JSON.stringify(dSearch.map((t) => [t.query, t.top_score])));
check("D", "threshold in the trace is still 0.55",
  dSearch.every((t) => t.threshold === 0.55),
  "ADR-11 is normative -- a demo is not a reason to move it");
check("D", "the reply carries a policy citation",
  d.events.some((e) => e.type === "citation" && e.ids.some((id) => id.startsWith("policy:"))));
check("D", "terminal status is resolved",
  d.events.find((e) => e.type === "done")?.status === "resolved",
  `got ${d.events.find((e) => e.type === "done")?.status}`);

console.log("\nSlice E -- ungrounded question escalates (AC-FAQ-03)");
const e = await runTurn({ message: "What is the capital of France?" });
sharedChecks("E", e);
/*
 * This slice asserts the GUARANTEE, not the route.
 *
 * There are two legitimate ways for an off-corpus question to end escalated, and which one
 * happens is a model decision that varies run to run: the coordinator delegates and faq-policy
 * reports the corpus cannot answer, or the coordinator tries to handle it alone and the
 * grounding guard (ADR-17) catches a turn that consulted nobody. An earlier version of this
 * slice required the first path and failed on a run that took the second — asserting the
 * mechanism rather than the promise. The promise is that the customer is never given an
 * ungrounded answer, and both paths keep it.
 */
const eSearch = e.trace.filter((t) => t.event === "policy_search");
const eForced = e.trace.find((t) => t.event === "forced_escalation");
check("E", "no policy section was ever passed off as an answer",
  eSearch.every((t) => t.grounded === false),
  JSON.stringify(eSearch.map((t) => [t.query, t.top_score])));
const eEsc = e.events.find((ev) => ev.type === "escalation");
check("E", "escalated rather than answered from model knowledge", eEsc !== undefined,
  "the coordinator answered a general-knowledge question itself");
console.log(
  `        route: ${eSearch.length > 0 ? "faq-policy reported not-covered" : "no specialist consulted"}` +
    `${eForced ? ` -> grounding guard forced it (${eForced.reason})` : ""}`,
);
check("E", "reason code is ungrounded", eEsc?.reasonCode === "ungrounded", `got ${eEsc?.reasonCode}`);
const eText = e.events.filter((ev) => ev.type === "token").map((ev) => ev.text).join("");
check("E", "the answer was not stated anyway", !/\bparis\b/i.test(eText), eText.slice(0, 160));

console.log("\nSlice F -- membership status (plus-specialist + DemoOverlay)");
const f = await runTurn({
  message: "Is my Plus free trial still active?",
  identity: { userId: TRIAL_OVERLAY_USER_ID },
});
sharedChecks("F", f);
check("F", "delegated to plus-specialist",
  f.trace.some((t) => t.event === "agent_hop" && JSON.stringify(t).includes("plus-specialist")));
check("F", "read the membership",
  f.trace.some((t) => t.event === "tool_call" && String(t.tool).includes("get_membership")));
check("F", "the overlay persona was used (ADR-14 precedence)",
  f.trace.some((t) => t.event === "overlay_hit"),
  "no overlay_hit -- the persona is the only live-trial row in the system");
check("F", "the reply cites the overlay, not a DuckDB row",
  f.events.some((ev) => ev.type === "citation" && ev.ids.some((id) => id.startsWith("overlay:"))));
check("F", "terminal status is resolved",
  f.events.find((ev) => ev.type === "done")?.status === "resolved",
  `got ${f.events.find((ev) => ev.type === "done")?.status}`);

console.log("\nSlice G -- return eligibility in ONE hop (SAD chain exception)");
// IN-window on purpose. An out-of-window order legitimately hops on to escalation-handoff for
// a human to consider an exception, so it can never demonstrate the one-hop rule — the first
// version of this slice used order 1 and failed on hops=2, which was the fixture being wrong
// rather than the chain exception being unimplemented.
const g = await runTurn({
  message: "Can I still return this order?",
  identity: { orderId: RECENT_ORDER_ID },
});
sharedChecks("G", g);
check("G", "delegated to returns-advisor",
  g.trace.some((t) => t.event === "agent_hop" && JSON.stringify(t).includes("returns-advisor")));
const gTools = g.trace.filter((t) => t.event === "tool_call").map((t) => String(t.tool));
check("G", "it read the order itself", gTools.some((t) => t.includes("get_order")));
check("G", "it read the policy itself", gTools.some((t) => t.includes("search_policy")));
// The hop rule, asserted rather than assumed: order tools + policy tools in ONE agent means
// ONE transfer. A second hop here would mean the chain exception is not implemented.
const gResult = g.trace.find((t) => t.event === "turn_result");
check("G", "the whole answer cost exactly one specialist hop", gResult?.hops === 1,
  `hops=${gResult?.hops}, path=${JSON.stringify(gResult?.path)}`);
const gText = g.events.filter((ev) => ev.type === "token").map((ev) => ev.text).join("");
check("G", "the eligibility answer is grounded in the order date",
  /2026-09-01|today/i.test(gText), gText.slice(0, 200));
check("G", "the 14-day window is stated from policy", /14[-\s]day/i.test(gText), gText.slice(0, 200));

console.log("\nSlice H -- restricted action, not a money tool (AC-PLUS-03)");
const h = await runTurn({
  message: "Please cancel my Plus membership",
  identity: { userId: PAID_PLUS_USER_ID },
});
sharedChecks("H", h);
const hEsc = h.events.find((ev) => ev.type === "escalation");
check("H", "escalation frame present", hEsc !== undefined);
check("H", "reason code is restricted_action", hEsc?.reasonCode === "restricted_action",
  `got ${hEsc?.reasonCode}`);
check("H", "terminal status is escalated",
  h.events.find((ev) => ev.type === "done")?.status === "escalated",
  `got ${h.events.find((ev) => ev.type === "done")?.status}`);
const hText = h.events.filter((ev) => ev.type === "token").map((ev) => ev.text).join("");
// The failure that matters most in this slice: claiming the cancellation was done.
check("H", "never claims the membership was cancelled",
  !/\b(have|has been|i've|we've)\s+(now\s+)?cancell?ed\b/i.test(hText), hText.slice(0, 200));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("FAILED:");
  for (const f of failed) {
    console.log(`  [${f.slice}] ${f.name}${f.detail ? ` -- ${f.detail}` : ""}`);
  }
  process.exit(1);
}
console.log("All 8 F-EVAL-01 scripts pass on the sdk engine.\n");
