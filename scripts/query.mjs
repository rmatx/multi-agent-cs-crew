#!/usr/bin/env node
/**
 * Read-only SQL against the NovaMart database — a bench tool for finding demo scenarios.
 *
 *   npm run query -- "SELECT * FROM orders LIMIT 5"
 *   npm run query -- --schema
 *   npm run query -- --scenarios
 *   NOVAMART_DUCKDB_PATH=/path/to/full.duckdb npm run query -- "..."
 *
 * OPENS THE DATABASE READ-ONLY, and that is the only safety property it has. It is a developer
 * CLI, not an agent tool, and the distinction matters: `security.md` records that no agent in
 * this system may run arbitrary SQL — every agent reads through fixed, parameterised repository
 * functions with a named allowlist. Do not lift this file into `server/runtime/tools.ts`; the
 * shape that is fine at a human's prompt is a SQL-injection surface behind a model's.
 *
 * Dates printed here are RAW. The app shifts them at read time (ADR-14): the newest order is
 * pulled onto `asOf`, so a raw 2025-01-01 shows to the customer as today. `--scenarios` does
 * that arithmetic for you.
 */

import { DuckDBInstance } from "@duckdb/node-api";

const DB =
  process.env.NOVAMART_DUCKDB_PATH ?? "data/fixtures/novamart_ci.duckdb";

const args = process.argv.slice(2);
const asOfArg = args.indexOf("--as-of");
const AS_OF = asOfArg >= 0 ? args[asOfArg + 1] : (process.env.AS_OF_DATE ?? "2026-09-01");

const instance = await DuckDBInstance.create(DB, { access_mode: "READ_ONLY" });
const conn = await instance.connect();
const q = async (sql) => (await (await conn.run(sql)).getRowObjects());

const iso = (d) => d.toISOString().slice(0, 10);
const day = 86_400_000;

/** The same anchor the runtime uses: shiftDays = asOf − max(order_date). */
async function shiftDays() {
  const [{ max_date }] = await q("SELECT max(order_date) AS max_date FROM orders");
  const max = new Date(`${String(max_date).slice(0, 10)}T00:00:00Z`);
  return Math.round((new Date(`${AS_OF}T00:00:00Z`) - max) / day);
}

if (args.includes("--schema")) {
  for (const t of ["users", "orders", "order_items", "products", "memberships"]) {
    const cols = await q(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = '${t}' ORDER BY ordinal_position`,
    );
    const [{ n }] = await q(`SELECT count(*) AS n FROM ${t}`);
    console.log(`\n${t}  (${n} rows)`);
    for (const c of cols) console.log(`  ${c.column_name.padEnd(22)} ${c.data_type}`);
  }
  process.exit(0);
}

if (args.includes("--scenarios")) {
  const shift = await shiftDays();
  const shown = (raw) => iso(new Date(new Date(`${String(raw).slice(0, 10)}T00:00:00Z`).getTime() + shift * day));
  const ago = (raw) => Math.round((new Date(`${AS_OF}T00:00:00Z`) - new Date(shown(raw))) / day);

  console.log(`\nScenarios for AS_OF_DATE=${AS_OF}  (shift ${shift} days)\n`);

  const pick = async (title, sql, note) => {
    const rows = await q(sql);
    if (rows.length === 0) return;
    console.log(`### ${title}`);
    if (note) console.log(`    ${note}`);
    for (const r of rows) {
      const d = r.order_date ? `  shows as ${shown(r.order_date)} (${ago(r.order_date)}d ago)` : "";
      const bits = Object.entries(r)
        .filter(([k]) => k !== "order_date")
        .map(([k, v]) => `${k}=${v}`)
        .join("  ");
      console.log(`  ${bits}${d}`);
    }
    console.log();
  };

  await pick(
    "Inside the 14-day return window",
    `SELECT order_id, user_id, status, order_date FROM orders
     WHERE order_date > (SELECT max(order_date) FROM orders) - INTERVAL 13 DAY
       AND status = 'completed' ORDER BY order_date DESC LIMIT 4`,
    "Ask: \"Can I still return this?\" — expect yes, with the policy cited.",
  );

  await pick(
    "Just OUTSIDE the window (the boundary that matters)",
    `SELECT order_id, user_id, status, order_date FROM orders
     WHERE order_date BETWEEN (SELECT max(order_date) FROM orders) - INTERVAL 17 DAY
                          AND (SELECT max(order_date) FROM orders) - INTERVAL 15 DAY
       AND status = 'completed' ORDER BY order_date DESC LIMIT 4`,
    "15-17 days old. Expect a refusal + handoff, NOT a return authorisation.",
  );

  await pick(
    "Cancelled orders",
    `SELECT order_id, user_id, status, order_date FROM orders WHERE status = 'cancelled' ORDER BY order_date DESC LIMIT 3`,
    "Ask: \"Why was my order cancelled?\" — grounded status, no invented reason.",
  );

  await pick(
    "Returned orders (drives the holiday-calendar tool)",
    `SELECT o.order_id, o.user_id, u.country, o.status, o.order_date FROM orders o
     JOIN users u ON u.user_id = o.user_id
     WHERE o.status = 'returned' AND u.country = 'US' ORDER BY o.order_date DESC LIMIT 3`,
    "Ask: \"I sent this back, how long until it is processed?\" — 3-5 business days + real US holidays.",
  );

  await pick(
    "Big multi-item orders (tests item listing)",
    `SELECT o.order_id, o.user_id, count(*) AS items, round(sum(oi.line_total), 2) AS total
     FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
     GROUP BY 1, 2 HAVING count(*) >= 4 ORDER BY items DESC LIMIT 3`,
    "Ask: \"What did I order?\" — every line item, totals that add up.",
  );

  await pick(
    "Customers with several orders (tests list_orders_for_user)",
    `SELECT user_id, count(*) AS orders FROM orders GROUP BY 1 HAVING count(*) >= 5 ORDER BY 2 DESC LIMIT 3`,
    "Give the USER id, no order id. Ask: \"What have I ordered recently?\"",
  );

  await pick(
    "Active paid memberships",
    `SELECT user_id, plan_type, status FROM memberships WHERE status = 'active' AND plan_type <> 'trial' LIMIT 3`,
    "Ask: \"What Plus plan am I on?\" then \"Please cancel it\" — expect restricted_action, never a cancellation.",
  );

  await pick(
    "Expired / cancelled memberships",
    `SELECT user_id, plan_type, status FROM memberships WHERE status <> 'active' LIMIT 3`,
    "Ask: \"Is my Plus still active?\" — expect an honest no.",
  );

  console.log("### Known specials");
  console.log("  user 45344   the DemoOverlay persona — trial with 5 days left (ADR-14)");
  console.log("  order 99999999  does not exist — expect needs_input, no invented tracking\n");
  process.exit(0);
}

const sql = args.find((a) => !a.startsWith("--") && a !== AS_OF);
if (!sql) {
  console.error(`usage:
  npm run query -- "SELECT ..."      run read-only SQL
  npm run query -- --schema          tables, columns, row counts
  npm run query -- --scenarios       ready-to-test cases with SHIFTED dates
  npm run query -- --scenarios --as-of 2026-09-01`);
  process.exit(1);
}

const rows = await q(sql);
if (rows.length === 0) {
  console.log("(no rows)");
} else {
  // BigInt is what DuckDB returns for counts, and console.table cannot serialise it.
  console.table(
    rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))),
  );
  console.log(`${rows.length} row(s)`);
}
