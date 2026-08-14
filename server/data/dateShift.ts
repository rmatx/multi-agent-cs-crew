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
 * DemoOverlay precedence is Sprint 2+; `overlayHit` is reported as false for now.
 */

import type { TemporalMeta } from "@shared/dto";
import { getMaxOrderDate } from "./duckdb";

const MS_PER_DAY = 86_400_000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function resolveAsOf(): string {
  const fromEnv = process.env.AS_OF_DATE?.trim();
  if (fromEnv !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(fromEnv)) return fromEnv;
  return toIsoDate(new Date());
}

function resolveAlignFlag(): boolean {
  return process.env.ALIGN_MAX_DATE_TO_TODAY?.trim().toLowerCase() !== "false";
}

/** Resolve the temporal context for a turn. One DB read for the anchor; no writes. */
export async function resolveTemporalMeta(): Promise<TemporalMeta> {
  const asOf = resolveAsOf();
  const alignMaxDateToToday = resolveAlignFlag();
  const override = process.env.DATE_SHIFT_DAYS?.trim();

  if (override !== undefined && override.length > 0 && Number.isFinite(Number(override))) {
    return {
      asOf,
      shiftDays: Math.trunc(Number(override)),
      alignMaxDateToToday,
      overlayHit: false,
    };
  }

  if (!alignMaxDateToToday) {
    return { asOf, shiftDays: 0, alignMaxDateToToday, overlayHit: false };
  }

  const maxOrderDate = await getMaxOrderDate();
  const shiftDays = Math.round(
    (parseIsoDate(asOf).getTime() - parseIsoDate(maxOrderDate).getTime()) / MS_PER_DAY,
  );
  return { asOf, shiftDays, alignMaxDateToToday, overlayHit: false };
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
