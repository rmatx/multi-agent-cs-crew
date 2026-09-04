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
import { normalizeCountryCode } from "./holidays";

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

/**
 * ISO country code for one user, or null if the user or the value is absent.
 *
 * `users` carries `country` and no address or postal code, so country is the finest location
 * grain this dataset honestly supports — which is what `get_processing_calendar` keys on.
 */
export async function getUserCountry(userId: number): Promise<string | null> {
  const rows = await queryRows(
    `SELECT country AS country
       FROM users
      WHERE user_id = ?
      LIMIT 1`,
    [userId],
  );
  // `normalizeCountryCode` maps the fixture's non-ISO codes (`UK` → `GB`) and rejects the
  // `other` bucket, so callers always get a code the holiday API can actually resolve.
  return normalizeCountryCode(rows[0]?.["country"] as string | undefined);
}

export async function getOrderItems(orderId: number): Promise<OrderLineItem[]> {
  const rows = await queryRows(
    `SELECT p.product_name AS product_name,
            p.category     AS category,
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
    category: asString(row["category"]),
    quantity: asNumber(row["quantity"]),
    lineTotal: asNumber(row["line_total"]),
  }));
}

/* --------------------------------------------------- Sprint 2 layer 4 reads (SAD §2) ---- */

/** Raw (unshifted) user row. `signup_date` MUST go through the DateShiftMapper. */
export type RawUserRow = {
  readonly userId: number;
  readonly signupDate: string;
  readonly country: string;
  readonly devicePrimary: string;
};

export async function getRawUser(userId: number): Promise<RawUserRow | null> {
  const rows = await queryRows(
    `SELECT CAST(user_id AS INTEGER)          AS user_id,
            strftime(signup_date, '%Y-%m-%d') AS signup_date,
            country                           AS country,
            device_primary                    AS device_primary
       FROM users
      WHERE user_id = ?
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    userId: asNumber(row["user_id"]),
    signupDate: asString(row["signup_date"]),
    country: asString(row["country"]),
    devicePrimary: asString(row["device_primary"]),
  };
}

/**
 * Raw (unshifted) membership row. `endedAt` is null for a live membership — in this dataset
 * `status = 'active'` and `ended_at IS NULL` are the same 1,409 rows.
 */
export type RawMembershipRow = {
  readonly membershipId: number;
  readonly userId: number;
  readonly planType: string;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly isCurrent: boolean;
  /** How many memberships this user has in total — a trial that converted leaves two rows. */
  readonly totalForUser: number;
};

/**
 * The membership that describes this user NOW: the current one if there is one, otherwise the
 * most recently started. A user who trialled and converted has two rows, and answering from
 * the older one would describe a membership that ended months ago as if it were live.
 */
export async function getRawMembership(userId: number): Promise<RawMembershipRow | null> {
  const rows = await queryRows(
    `SELECT CAST(m.membership_id AS INTEGER)     AS membership_id,
            CAST(m.user_id AS INTEGER)           AS user_id,
            m.plan_type                          AS plan_type,
            m.status                             AS status,
            strftime(m.started_at, '%Y-%m-%d')   AS started_at,
            strftime(m.ended_at, '%Y-%m-%d')     AS ended_at,
            m.is_current                         AS is_current,
            CAST(count(*) OVER ()  AS INTEGER)   AS total_for_user
       FROM memberships m
      WHERE m.user_id = ?
      ORDER BY m.is_current DESC, m.started_at DESC
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const endedAt = row["ended_at"];
  return {
    membershipId: asNumber(row["membership_id"]),
    userId: asNumber(row["user_id"]),
    planType: asString(row["plan_type"]),
    status: asString(row["status"]),
    startedAt: asString(row["started_at"]),
    endedAt: endedAt === null || endedAt === undefined ? null : asString(endedAt),
    isCurrent: row["is_current"] === true,
    totalForUser: asNumber(row["total_for_user"]),
  };
}

/** Raw (unshifted) order rows for one user, newest first. `limit` is capped by the caller. */
export async function listRawOrdersForUser(
  userId: number,
  limit: number,
): Promise<RawOrderRow[]> {
  const rows = await queryRows(
    `SELECT CAST(order_id AS INTEGER)        AS order_id,
            CAST(user_id AS INTEGER)         AS user_id,
            status                           AS status,
            strftime(order_date, '%Y-%m-%d') AS order_date,
            total_amount                     AS total_amount
       FROM orders
      WHERE user_id = ?
      ORDER BY order_date DESC, order_id DESC
      LIMIT ?`,
    [userId, limit],
  );
  return rows.map((row) => ({
    orderId: asNumber(row["order_id"]),
    userId: asNumber(row["user_id"]),
    status: asString(row["status"]),
    orderDate: asString(row["order_date"]),
    totalAmount: asNumber(row["total_amount"]),
  }));
}
