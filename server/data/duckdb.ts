/**
 * Read-only DuckDB adapter for the NovaMart practice DB (SAD §4 "Data architecture", ADR-05).
 *
 * Hard rule: this connection is opened READ_ONLY and this module exposes reads only.
 * Any UPDATE/INSERT/DELETE against the practice DB is a defect (SAD §4 temporal layer rules).
 * Server-only — imported from route handlers, never from a client component (ADR-09).
 */

import path from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { OrderLineItem, OrderSummary } from "@shared/dto";

/** Committed CI fixture: 5 MVP tables, all rows, 3.2 MB (SAD-OQ-6 resolution / ADR-12). */
const DEFAULT_DB_RELATIVE_PATH = "data/fixtures/novamart_ci.duckdb";

export function resolveDbPath(): string {
  const fromEnv = process.env.NOVAMART_DUCKDB_PATH?.trim();
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_DB_RELATIVE_PATH;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

let connectionPromise: Promise<DuckDBConnection> | null = null;

/** Lazily opened, process-wide, READ ONLY. */
export function getConnection(): Promise<DuckDBConnection> {
  if (connectionPromise === null) {
    connectionPromise = (async () => {
      const instance = await DuckDBInstance.create(resolveDbPath(), {
        access_mode: "READ_ONLY",
      });
      return instance.connect();
    })().catch((err: unknown) => {
      connectionPromise = null;
      throw err;
    });
  }
  return connectionPromise;
}

async function queryRows(
  sql: string,
  params: readonly (string | number)[] = [],
): Promise<Record<string, unknown>[]> {
  const connection = await getConnection();
  const reader = await connection.runAndReadAll(sql, [...params]);
  return reader.getRowObjects() as unknown as Record<string, unknown>[];
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value ?? 0);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/** Anchor for the date shift: max(order_date) across the practice DB. */
export async function getMaxOrderDate(): Promise<string> {
  const rows = await queryRows(
    "SELECT strftime(max(order_date), '%Y-%m-%d') AS max_order_date FROM orders",
  );
  return asString(rows[0]?.["max_order_date"]);
}

/** Raw (unshifted) order row. Callers MUST pass it through the DateShiftMapper. */
export type RawOrderRow = Omit<OrderSummary, "items">;

export async function getRawOrder(orderId: number): Promise<RawOrderRow | null> {
  const rows = await queryRows(
    `SELECT CAST(order_id AS INTEGER)     AS order_id,
            CAST(user_id AS INTEGER)      AS user_id,
            status                        AS status,
            strftime(order_date, '%Y-%m-%d') AS order_date,
            total_amount                  AS total_amount
       FROM orders
      WHERE order_id = ?
      LIMIT 1`,
    [orderId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    orderId: asNumber(row["order_id"]),
    userId: asNumber(row["user_id"]),
    status: asString(row["status"]),
    orderDate: asString(row["order_date"]),
    totalAmount: asNumber(row["total_amount"]),
  };
}

export async function getOrderItems(orderId: number): Promise<OrderLineItem[]> {
  const rows = await queryRows(
    `SELECT p.product_name AS product_name,
            CAST(oi.quantity AS INTEGER) AS quantity,
            oi.line_total  AS line_total
       FROM order_items oi
       JOIN products p ON p.product_id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.order_item_id`,
    [orderId],
  );
  return rows.map((row) => ({
    productName: asString(row["product_name"]),
    quantity: asNumber(row["quantity"]),
    lineTotal: asNumber(row["line_total"]),
  }));
}
