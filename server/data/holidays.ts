/**
 * Public-holiday calendar client — the ONE external data integration in this build
 * (SAD §4 "External systems / integration points", amended 2026-08-25).
 *
 * Source: Nager.Date v3, `GET {base}/api/v3/PublicHolidays/{year}/{countryCode}`. Keyless and
 * read-only. Chosen over carrier tracking because `orders` has no tracking number and no
 * in-transit rows, so tracking would have meant inventing shipments; `users.country` is real
 * fixture data, so this integration is grounded in facts the dataset actually holds.
 *
 * It answers RETURN AND REFUND PROCESSING time, not delivery. The first draft keyed on
 * delivery and could never fire: every order in the fixture is terminal (completed,
 * cancelled, returned), so "not yet delivered" matched nothing — the same absence that ruled
 * out tracking. The 2,369 `returned` orders are real, and "why is my refund slow" is a
 * question a holiday calendar can honestly inform.
 *
 * THIS MODULE HAS NO IMPORTS, ON PURPOSE — same reasoning as `toolRegistry.ts`. Its unit test
 * runs under `node --test` type stripping and injects a fake `fetch`, so CI never touches the
 * network.
 *
 * Safety properties, in order of importance:
 *   1. NEVER THROWS. Every failure resolves to `{ ok: false }`. A support turn must still
 *      answer from DuckDB when a third party is down — an external dependency may degrade the
 *      answer, never break the turn.
 *   2. NO SSRF SURFACE. The host comes from `HOLIDAY_API_BASE_URL` (an operator setting), and
 *      only the year and a validated 2-letter country code are interpolated. Nothing
 *      model-supplied or customer-supplied reaches the URL.
 *   3. BOUNDED. Explicit timeout via AbortSignal; no implicit default.
 *   4. CACHED. Holidays change at most yearly, so `{country}:{year}` is cached for the life of
 *      the process. Repeated turns cost one upstream call.
 */

export const DEFAULT_HOLIDAY_API_BASE_URL = "https://date.nager.at";
export const DEFAULT_HOLIDAY_TIMEOUT_MS = 3_000;

/** One upcoming public holiday, trimmed to what a support answer actually needs. */
export type Holiday = {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** English name. */
  name: string;
  /** Name in the country's own language, when it differs. */
  localName: string;
  /** True when the holiday applies nationwide rather than to some regions only. */
  nationwide: boolean;
};

export type HolidayLookup =
  | { ok: true; country: string; year: number; holidays: Holiday[]; cached: boolean }
  | { ok: false; country: string; year: number; reason: HolidayFailure };

/** Why a lookup produced no data. Surfaced to the model verbatim so it can be honest. */
export type HolidayFailure =
  | "invalid_country"
  | "timeout"
  | "unreachable"
  | "upstream_error"
  | "malformed_response";

export type HolidayClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; omit to use the process-wide cache. */
  cache?: Map<string, Holiday[]>;
};

const processCache = new Map<string, Holiday[]>();

/** Exposed for tests and for operators who need to force a refresh. */
export function clearHolidayCache(): void {
  processCache.clear();
}

function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

/**
 * Dataset country codes that are NOT ISO 3166-1 alpha-2. The NovaMart fixture stores `UK`,
 * which Nager.Date 404s on — the ISO code for the United Kingdom is `GB`. Without this the
 * ~12% of users in that bucket would degrade to `upstream_error` and nobody would notice,
 * because a degraded lookup is designed to look ordinary.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = { UK: "GB" };

/**
 * Dataset code → ISO 3166-1 alpha-2, or `null` when the value is not a country at all (the
 * fixture's `other` bucket, an empty cell). Callers pass the result straight to
 * `fetchPublicHolidays`.
 */
export function normalizeCountryCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  const mapped = COUNTRY_ALIASES[upper] ?? upper;
  return isCountryCode(mapped) ? mapped : null;
}

/** Narrow an unknown upstream payload to our own shape, discarding anything unexpected. */
function parseHolidays(payload: unknown): Holiday[] | null {
  if (!Array.isArray(payload)) return null;
  const out: Holiday[] = [];
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const date = row["date"];
    const name = row["name"];
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (typeof name !== "string" || name.length === 0) continue;
    out.push({
      date,
      name,
      localName: typeof row["localName"] === "string" ? row["localName"] : name,
      // Absent `global` is treated as regional: understating coverage is the safe direction.
      nationwide: row["global"] === true,
    });
  }
  return out;
}

/**
 * Public holidays for one country and year. Resolves to `{ok:false}` rather than rejecting —
 * see property 1 above.
 */
export async function fetchPublicHolidays(
  countryCode: string,
  year: number,
  options: HolidayClientOptions = {},
): Promise<HolidayLookup> {
  const country = normalizeCountryCode(countryCode);
  if (country === null || !Number.isInteger(year)) {
    return {
      ok: false,
      country: countryCode.trim().toUpperCase(),
      year,
      reason: "invalid_country",
    };
  }

  const cache = options.cache ?? processCache;
  const key = `${country}:${year}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    return { ok: true, country, year, holidays: hit, cached: true };
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_HOLIDAY_API_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_HOLIDAY_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${baseUrl}/api/v3/PublicHolidays/${year}/${country}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false, country, year, reason: "upstream_error" };
    }
    const parsed = parseHolidays(await response.json());
    if (parsed === null) {
      return { ok: false, country, year, reason: "malformed_response" };
    }
    cache.set(key, parsed);
    return { ok: true, country, year, holidays: parsed, cached: false };
  } catch (err) {
    const aborted = controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
    return { ok: false, country, year, reason: aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Holidays on or after `asOf`, soonest first, deduped, capped at `limit`.
 *
 * `asOf` is the turn's shifted "today", so this composes with the temporal layer rather than
 * reading a real clock — the same discipline every other date in this system follows.
 *
 * Upstream lists the same holiday twice when it has both a regional and a national variant
 * (a live US lookup returns Columbus Day as `global:false` and `global:true`). Telling a
 * customer about one holiday twice reads as a bug, so same date + same name collapses to one
 * entry, keeping the nationwide variant — the one that actually stops processing.
 */
export function upcomingFrom(holidays: readonly Holiday[], asOf: string, limit = 3): Holiday[] {
  const byKey = new Map<string, Holiday>();
  for (const holiday of holidays) {
    if (holiday.date < asOf) continue;
    const key = `${holiday.date}:${holiday.name}`;
    const kept = byKey.get(key);
    if (kept === undefined || (!kept.nationwide && holiday.nationwide)) {
      byKey.set(key, holiday);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

/** Whole days from `asOf` to `date`, both ISO. Negative means past. */
export function daysUntil(asOf: string, date: string): number {
  const from = Date.parse(`${asOf}T00:00:00Z`);
  const to = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}
