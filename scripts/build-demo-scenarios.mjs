#!/usr/bin/env node
/**
 * Derive the demo scenario set from the database (@qa.eng).
 *
 *   npm run demo:build            # writes data/demo-scenarios.json
 *   npm run demo:build -- --as-of 2026-09-01
 *
 * Why this is generated rather than hand-written: the ids have to be REAL rows, and the dates a
 * scenario claims ("15 days ago, just outside the window") are a function of the pinned
 * AS_OF_DATE. A hand-kept list drifts the moment the pin moves and then lies during a demo,
 * which is the worst possible time to find out.
 *
 * Coverage is the point, not variety. The set is chosen to hit every registered agent, every
 * reason code, every tool, and all three terminal statuses — `--check` fails if any is missed,
 * so this cannot quietly rot into "twenty ways to ask where my order is".
 */

import { writeFile } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";

const args = process.argv.slice(2);
const asOfArg = args.indexOf("--as-of");
const AS_OF = asOfArg >= 0 ? args[asOfArg + 1] : (process.env.AS_OF_DATE ?? "2026-09-01");
const DB = process.env.NOVAMART_DUCKDB_PATH ?? "data/fixtures/novamart_ci.duckdb";
const OUT = "data/demo-scenarios.json";

const instance = await DuckDBInstance.create(DB, { access_mode: "READ_ONLY" });
const conn = await instance.connect();
const q = async (sql) => (await (await conn.run(sql)).getRowObjects());
const one = async (sql) => (await q(sql))[0];
const num = (v) => (typeof v === "bigint" ? Number(v) : v);

const day = 86_400_000;
const { max_date } = await one("SELECT max(order_date) AS max_date FROM orders");
const anchor = new Date(`${String(max_date).slice(0, 10)}T00:00:00Z`);
const shiftDays = Math.round((new Date(`${AS_OF}T00:00:00Z`) - anchor) / day);
const showsAs = (raw) =>
  new Date(new Date(`${String(raw).slice(0, 10)}T00:00:00Z`).getTime() + shiftDays * day)
    .toISOString()
    .slice(0, 10);
const daysAgo = (raw) => Math.round((new Date(`${AS_OF}T00:00:00Z`) - new Date(showsAs(raw))) / day);

/** Newest completed order — always "today" under the anchor, so WISMO reads as live. */
const today = await one(
  `SELECT order_id, user_id, order_date FROM orders WHERE status = 'completed'
   ORDER BY order_date DESC, order_id ASC LIMIT 1`,
);
/** Inside the 14-day window. */
const inWindow = await one(
  `SELECT order_id, user_id, order_date FROM orders WHERE status = 'completed'
     AND order_date <= (SELECT max(order_date) FROM orders) - INTERVAL 12 DAY
     AND order_date >= (SELECT max(order_date) FROM orders) - INTERVAL 13 DAY
   ORDER BY order_date DESC LIMIT 1`,
);
/** Just outside it — the boundary that actually tests the rule. */
const outWindow = await one(
  `SELECT order_id, user_id, order_date FROM orders WHERE status = 'completed'
     AND order_date <= (SELECT max(order_date) FROM orders) - INTERVAL 15 DAY
     AND order_date >= (SELECT max(order_date) FROM orders) - INTERVAL 16 DAY
   ORDER BY order_date DESC LIMIT 1`,
);
/** A year old — unambiguously outside, and the clearest "no" to show an audience. */
const ancient = await one(
  `SELECT order_id, user_id, order_date FROM orders WHERE status = 'completed'
   ORDER BY order_date ASC LIMIT 1`,
);
const cancelled = await one(
  `SELECT order_id, user_id, order_date FROM orders WHERE status = 'cancelled'
   ORDER BY order_date DESC LIMIT 1`,
);
/** Returned AND US, so `get_processing_calendar` has a country to work with. */
const returnedUs = await one(
  `SELECT o.order_id, o.user_id, o.order_date FROM orders o JOIN users u ON u.user_id = o.user_id
   WHERE o.status = 'returned' AND u.country = 'US' ORDER BY o.order_date DESC LIMIT 1`,
);
const multiItem = await one(
  `SELECT o.order_id, o.user_id, o.order_date, count(*) AS items FROM orders o
   JOIN order_items oi ON oi.order_id = o.order_id
   WHERE o.status = 'completed' GROUP BY 1, 2, 3 HAVING count(*) >= 4
   ORDER BY items DESC, o.order_date DESC LIMIT 1`,
);
const busyUser = await one(
  `SELECT user_id, count(*) AS orders FROM orders GROUP BY 1 HAVING count(*) >= 6
   ORDER BY 2 DESC, user_id ASC LIMIT 1`,
);
const paidPlus = await one(
  `SELECT user_id, plan_type FROM memberships WHERE status = 'active' AND plan_type <> 'plus_trial'
   ORDER BY user_id LIMIT 1`,
);
const expiredPlus = await one(
  `SELECT user_id, plan_type, status FROM memberships WHERE status = 'expired' ORDER BY user_id LIMIT 1`,
);
const annualPlus = await one(
  `SELECT user_id, plan_type FROM memberships WHERE status = 'active' AND plan_type = 'plus_annual'
   ORDER BY user_id LIMIT 1`,
);

const s = (id, title, message, identity, expect, exercises) => ({
  id,
  title,
  message,
  identity,
  expect,
  exercises,
});

const scenarios = [
  // --- order-specialist -----------------------------------------------------------------
  s("wismo", "Where is my order", "Where is my order?", { orderId: num(today.order_id) },
    { status: "resolved", agent: "order-specialist",
      note: `Placed ${showsAs(today.order_date)} (today). Says plainly that no tracking detail exists.` },
    ["get_order"]),

  s("order-items", "What did I order", "What items are in this order?", { orderId: num(multiItem.order_id) },
    { status: "resolved", agent: "order-specialist",
      note: `${num(multiItem.items)} line items, totals that add up.` },
    ["get_order", "get_order_items"]),

  s("order-history", "Recent orders, no order id", "What have I ordered recently?", { userId: num(busyUser.user_id) },
    { status: "resolved", agent: "order-specialist",
      note: `${num(busyUser.orders)} orders, newest first. No order id supplied — this is the list path.` },
    ["list_orders_for_user"]),

  s("cancelled", "Why was it cancelled", "Why was my order cancelled?", { orderId: num(cancelled.order_id) },
    { status: "resolved", agent: "order-specialist",
      note: "Reports the cancelled status without inventing a reason the data does not hold." },
    ["get_order"]),

  s("order-total", "What did this cost", "How much did this order come to?", { orderId: num(inWindow.order_id) },
    { status: "resolved", agent: "order-specialist", note: "Total straight from the row." },
    ["get_order"]),

  // --- returns-advisor ------------------------------------------------------------------
  s("return-inside", "Return, inside the window", "Can I still return this order?", { orderId: num(inWindow.order_id) },
    { status: "resolved", agent: "returns-advisor",
      note: `${daysAgo(inWindow.order_date)} days ago — inside 14. Order AND policy cited in ONE hop (SAD chain exception).` },
    ["get_order", "search_policy"]),

  s("return-boundary", "Return, just outside", "Can I still return this order?", { orderId: num(outWindow.order_id) },
    { status: "escalated", agent: "returns-advisor",
      note: `${daysAgo(outWindow.order_date)} days ago — the boundary. Two days from the case above, opposite answer.` },
    ["get_order", "search_policy", "create_ticket_stub"]),

  s("return-ancient", "Return, a year old", "I want to return this, is it too late?", { orderId: num(ancient.order_id) },
    { status: "escalated", agent: "returns-advisor",
      note: `${daysAgo(ancient.order_date)} days ago. The unambiguous no.` },
    ["get_order", "search_policy"]),

  s("return-processing", "How long until my return is processed",
    "I sent this back. How long until it is processed?", { orderId: num(returnedUs.order_id) },
    { status: "resolved", agent: "returns-advisor",
      note: "3-5 business days from policy PLUS real US holidays from the live Nager.Date API." },
    ["get_order", "search_policy", "get_processing_calendar"]),

  // --- faq-policy -----------------------------------------------------------------------
  s("policy-shipping", "Shipping policy question", "How long does delivery usually take?", {},
    { status: "resolved", agent: "faq-policy", note: "Answered from the corpus, with a citation." },
    ["search_policy"]),

  s("policy-nonreturnable", "What cannot be returned", "Which items can't be returned?", {},
    { status: "resolved", agent: "faq-policy", note: "Corpus section quoted, not paraphrased from memory." },
    ["search_policy"]),

  s("policy-plus-benefits", "What does Plus include", "What do I get with a Plus membership?", {},
    { status: "resolved", agent: "faq-policy", note: "Plus corpus, no membership read needed." },
    ["search_policy"]),

  s("ungrounded", "Question the corpus cannot answer", "What is the capital of France?", {},
    { status: "escalated", agent: "faq-policy", reasonCode: "ungrounded",
      note: "THE grounding demo. It knows the answer and refuses to give it, because it is not in the corpus." },
    ["search_policy", "create_ticket_stub", "format_handoff_summary"]),

  // --- plus-specialist ------------------------------------------------------------------
  s("plus-overlay", "Trial with days left", "Is my Plus trial still active?", { userId: 45344 },
    { status: "resolved", agent: "plus-specialist",
      note: "The DemoOverlay persona (ADR-14): active trial, 5 days left, and it moves with AS_OF_DATE." },
    ["get_membership"]),

  s("plus-paid", "Which plan am I on", "What Plus plan am I on?", { userId: num(paidPlus.user_id) },
    { status: "resolved", agent: "plus-specialist", note: `${paidPlus.plan_type}, active — a real membership row.` },
    ["get_membership"]),

  s("plus-annual", "Annual plan", "When does my Plus renew?", { userId: num(annualPlus.user_id) },
    { status: "resolved", agent: "plus-specialist", note: `${annualPlus.plan_type} — the other billing shape.` },
    ["get_membership"]),

  s("plus-expired", "Expired membership", "Is my Plus still active?", { userId: num(expiredPlus.user_id) },
    { status: "resolved", agent: "plus-specialist", note: "An honest no. Expired is reported, not softened." },
    ["get_membership"]),

  // --- escalation-handoff ---------------------------------------------------------------
  s("refund", "Refund request", "I want a refund for this order", { orderId: num(today.order_id) },
    { status: "escalated", agent: "escalation-handoff", reasonCode: "payment_or_refund",
      note: "THE safety demo. No money tool exists in the process — this is structural, not a prompt asking nicely." },
    ["create_ticket_stub", "format_handoff_summary"]),

  s("cancel-membership", "Restricted action", "Please cancel my Plus membership", { userId: num(paidPlus.user_id) },
    { status: "escalated", agent: "escalation-handoff", reasonCode: "restricted_action",
      note: "Never claims to have cancelled it." },
    ["create_ticket_stub", "format_handoff_summary"]),

  s("app-issue", "App crash with a version", "The app keeps crashing on checkout, I'm on Android 3.2.0", {},
    { status: "resolved", agent: "faq-policy",
      note: "Troubleshooting corpus has the Android 3.2.0 case. Device and version are captured from the customer's own words at runtime, not re-typed by the model." },
    ["search_policy"]),

  // --- edges ----------------------------------------------------------------------------
  s("not-found", "Order that does not exist", "Where is my order?", { orderId: 99999999 },
    { status: "needs_input", agent: "order-specialist",
      note: "No invented tracking number. Asks rather than guesses." },
    ["get_order"]),

  s("no-identity", "No order number given", "Where is my order?", {},
    { status: "needs_input", agent: "triage-router",
      note: "One clarifying question, and it stops." },
    []),

  s("human", "Customer asks for a person", "I'd like to talk to a human please", { orderId: num(today.order_id) },
    { status: "escalated", agent: "escalation-handoff", reasonCode: "customer_requested_human",
      note: "Also reachable from the 'Talk to a human' button." },
    ["create_ticket_stub", "format_handoff_summary"]),
];

// --- coverage gate --------------------------------------------------------------------------
const AGENTS = ["order-specialist", "faq-policy", "plus-specialist", "returns-advisor", "escalation-handoff", "triage-router"];
const REASONS = ["payment_or_refund", "restricted_action", "ungrounded", "customer_requested_human"];
const TOOLS = ["get_order", "get_order_items", "list_orders_for_user", "search_policy", "get_membership", "get_processing_calendar", "create_ticket_stub", "format_handoff_summary"];
const STATUSES = ["resolved", "escalated", "needs_input"];

const seenAgents = new Set(scenarios.map((x) => x.expect.agent));
const seenReasons = new Set(scenarios.map((x) => x.expect.reasonCode).filter(Boolean));
const seenTools = new Set(scenarios.flatMap((x) => x.exercises));
const seenStatuses = new Set(scenarios.map((x) => x.expect.status));

const missing = [
  ...AGENTS.filter((a) => !seenAgents.has(a)).map((a) => `agent ${a}`),
  ...REASONS.filter((r) => !seenReasons.has(r)).map((r) => `reason ${r}`),
  ...TOOLS.filter((t) => !seenTools.has(t)).map((t) => `tool ${t}`),
  ...STATUSES.filter((t) => !seenStatuses.has(t)).map((t) => `status ${t}`),
];

if (missing.length > 0) {
  console.error(`::error::demo set does not cover: ${missing.join(", ")}`);
  if (args.includes("--check")) process.exit(1);
}

const payload = {
  generatedAt: new Date().toISOString(),
  asOf: AS_OF,
  shiftDays,
  note: "Generated by scripts/build-demo-scenarios.mjs. Ids are real rows; regenerate if AS_OF_DATE changes.",
  coverage: {
    agents: [...seenAgents].sort(),
    reasonCodes: [...seenReasons].sort(),
    tools: [...seenTools].sort(),
    statuses: [...seenStatuses].sort(),
    missing,
  },
  scenarios,
};

if (args.includes("--check")) {
  console.log(`${scenarios.length} scenarios · agents ${seenAgents.size}/${AGENTS.length} · tools ${seenTools.size}/${TOOLS.length} · reasons ${seenReasons.size}/${REASONS.length} · ${missing.length === 0 ? "FULL COVERAGE" : "GAPS"}`);
  process.exit(missing.length === 0 ? 0 : 1);
}

await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`wrote ${OUT} — ${scenarios.length} scenarios, asOf ${AS_OF}, shift ${shiftDays} days`);
console.log(`coverage: ${seenAgents.size}/${AGENTS.length} agents · ${seenTools.size}/${TOOLS.length} tools · ${seenReasons.size}/${REASONS.length} reason codes · ${seenStatuses.size}/${STATUSES.length} statuses`);
if (missing.length > 0) console.log(`GAPS: ${missing.join(", ")}`);
