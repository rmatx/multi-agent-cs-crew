/**
 * DemoOverlay — ADR-14 / PRD F-TIME-01.
 *
 * Hand-authored personas checked BEFORE DuckDB, with dates expressed as offsets from `asOf`
 * so they are already on the current calendar and never go through `DateShiftMapper`.
 *
 * WHY IT EXISTS AT ALL, given the rule that a stub must never return plausible-looking fake
 * data: the overlay is not a stub standing in for an unbuilt read — it is a declared, traced
 * data source with the same standing as the fixture, and a turn that uses it says so
 * (`overlayHit`). SAD §4 consequence 2 anticipated one specific gap that the shift cannot
 * close: no user's CURRENT membership is a live trial, because every trial in the fixture
 * either converted or expired on or before the order anchor. Without the overlay, "is my
 * free trial still running" is a question the six-agent crew can route perfectly and never
 * answer affirmatively.
 *
 * Keep this file small. Anything the database can already evidence must come from the
 * database.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { shiftIsoDate } from "./dateShift";

const DEFAULT_OVERLAY_RELATIVE_PATH = "data/demo_overlay.json";

export function resolveOverlayPath(): string {
  const fromEnv = process.env.DEMO_OVERLAY_PATH?.trim();
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OVERLAY_RELATIVE_PATH;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

type OverlayMembership = {
  readonly membershipId: number;
  readonly planType: string;
  readonly status: string;
  readonly startedDaysBeforeAsOf: number;
  /** Null means open-ended. */
  readonly endsDaysAfterAsOf: number | null;
};

type OverlayPersona = {
  readonly userId: number;
  readonly label: string;
  readonly membership?: OverlayMembership;
};

/** A membership already expressed on the current calendar — no shift is applied to these. */
export type OverlayMembershipRow = {
  readonly membershipId: number;
  readonly userId: number;
  readonly planType: string;
  readonly status: string;
  readonly startedOn: string;
  readonly endsOn: string | null;
  readonly personaLabel: string;
};

let cached: Map<number, OverlayPersona> | null = null;

/**
 * Load the overlay. A MISSING file is not an error — the overlay is optional by design, and
 * the system answers from DuckDB alone without it. A malformed file IS an error: silently
 * ignoring bad JSON would turn a typo into "the persona just doesn't work", which is the
 * kind of failure that gets discovered during a demo.
 */
function load(): Map<number, OverlayPersona> {
  if (cached !== null) return cached;

  const personas = new Map<number, OverlayPersona>();
  let raw: string;
  try {
    raw = readFileSync(resolveOverlayPath(), "utf8");
  } catch {
    cached = personas;
    return personas;
  }

  const parsed = JSON.parse(raw) as { personas?: OverlayPersona[] };
  for (const persona of parsed.personas ?? []) {
    if (typeof persona.userId !== "number") {
      throw new Error(`Demo overlay persona is missing a numeric userId: ${JSON.stringify(persona)}`);
    }
    personas.set(persona.userId, persona);
  }

  cached = personas;
  return personas;
}

/** Test seam — the overlay is process-cached. */
export function resetOverlayCache(): void {
  cached = null;
}

/** Does this turn's identity match a persona? Drives `TemporalMeta.overlayHit`. */
export function hasOverlayPersona(identity: {
  userId?: number | undefined;
  orderId?: number | undefined;
}): boolean {
  if (identity.userId === undefined) return false;
  return load().has(identity.userId);
}

/**
 * Overlay membership for a user, already on the current calendar, or null to fall through to
 * DuckDB. Offsets are resolved against `asOf` on every call, so the persona never expires.
 */
export function lookupMembership(userId: number, asOf: string): OverlayMembershipRow | null {
  const persona = load().get(userId);
  if (persona?.membership === undefined) return null;

  const m = persona.membership;
  return {
    membershipId: m.membershipId,
    userId,
    planType: m.planType,
    status: m.status,
    startedOn: shiftIsoDate(asOf, -m.startedDaysBeforeAsOf),
    endsOn: m.endsDaysAfterAsOf === null ? null : shiftIsoDate(asOf, m.endsDaysAfterAsOf),
    personaLabel: persona.label,
  };
}
