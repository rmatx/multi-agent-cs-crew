/**
 * Minimal DateShiftMapper — SAD §4 "Temporal layer (ADR-14 / PRD F-TIME-01)".
 *
 * The practice DB is frozen at 2024–2025. The shift is applied HERE, inside the repository
 * adapter, so raw dates never reach the agent, the response, or the UI.
 *
 * Knobs (SAD §4 table):
 *   ALIGN_MAX_DATE_TO_TODAY (default true) → shiftDays = asOf − max(order_date)
 *   AS_OF_DATE (default today)             → clock for eligibility + shift anchor
 *   DATE_SHIFT_DAYS                        → if set, overrides the auto shift
 *
 * Shifted dates are deliberately NOT clamped to asOf (SAD §4 consequence 1).
 * `overlayHit` reports whether THIS TURN'S identity matches a DemoOverlay persona (ADR-14).
 */

import type { TemporalMeta } from "@shared/dto";
import { hasOverlayPersona } from "./demoOverlay";
import { getMaxOrderDate } from "./duckdb";

const MS_PER_DAY = 86_400_000;

/**
 * UTC calendar date. Correct for the SHIFT ARITHMETIC only: `parseIsoDate` anchors every date
 * at UTC midnight, so the formatter that reads those Dates back must be UTC too. Formatting
 * them with local getters would move every shifted date back a day west of Greenwich.
 *
 * For "what day is it right now", use `todayIsoLocal` instead — see INT-02 below.
 */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The SERVER'S LOCAL calendar date — what "today" means to a person.
 *
 * INT-02 (integration.md, 2026-08-27): `asOf` was derived from `toISOString()`, which is UTC,
 * so west of Greenwich it rolled over early. Measured at 21:29 CDT on 2026-08-27 the assistant
 * reported `asOf=2026-08-28` and shifted every order date with it, so an order placed today
 * read as yesterday. A support bot telling a customer it is already tomorrow is wrong in the
 * way people notice.
 *
 * Local is the right default for a single-region MVP: it is the day the operator and the demo
 * audience are living in. `AS_OF_DATE` still overrides for reproducible evals, and a
 * multi-region deployment would need the CUSTOMER'S zone rather than either of these.
 */
function todayIsoLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function resolveAsOf(): string {
  const fromEnv = process.env.AS_OF_DATE?.trim();
  if (fromEnv !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(fromEnv)) return fromEnv;
  return todayIsoLocal();
}

function resolveAlignFlag(): boolean {
  return process.env.ALIGN_MAX_DATE_TO_TODAY?.trim().toLowerCase() !== "false";
}

/**
 * Resolve the temporal context for a turn. One DB read for the anchor; no writes.
 *
 * `identity` is taken so `overlayHit` can be answered honestly BEFORE the turn runs: the
 * header goes out with the response, and the only thing knowable that early is whether this
 * turn's customer matches a persona. A tool that actually reads the overlay also logs an
 * `overlay_hit` trace event, so the two are checkable against each other.
 */
export async function resolveTemporalMeta(
  identity: { userId?: number | undefined; orderId?: number | undefined } = {},
): Promise<TemporalMeta> {
  const asOf = resolveAsOf();
  const alignMaxDateToToday = resolveAlignFlag();
  const overlayHit = hasOverlayPersona(identity);
  const override = process.env.DATE_SHIFT_DAYS?.trim();

  if (override !== undefined && override.length > 0 && Number.isFinite(Number(override))) {
    return {
      asOf,
      shiftDays: Math.trunc(Number(override)),
      alignMaxDateToToday,
      overlayHit,
    };
  }

  if (!alignMaxDateToToday) {
    return { asOf, shiftDays: 0, alignMaxDateToToday, overlayHit };
  }

  const maxOrderDate = await getMaxOrderDate();
  const shiftDays = Math.round(
    (parseIsoDate(asOf).getTime() - parseIsoDate(maxOrderDate).getTime()) / MS_PER_DAY,
  );
  return { asOf, shiftDays, alignMaxDateToToday, overlayHit };
}

/** Apply the uniform offset to one ISO date. Relative intervals are preserved. */
export function shiftIsoDate(isoDate: string, shiftDays: number): string {
  const shifted = new Date(parseIsoDate(isoDate).getTime() + shiftDays * MS_PER_DAY);
  return toIsoDate(shifted);
}

/** Whole days between an already-shifted date and asOf (negative = future). */
export function daysSince(shiftedIsoDate: string, asOf: string): number {
  return Math.round(
    (parseIsoDate(asOf).getTime() - parseIsoDate(shiftedIsoDate).getTime()) / MS_PER_DAY,
  );
}
