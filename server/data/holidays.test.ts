/**
 * Unit tests for the external holiday integration (`server/data/holidays.ts`).
 *
 * Every test injects a fake `fetch` — no network, per the "test with mocks" discipline. The
 * cases that matter are the failure ones: this is the first non-Anthropic outbound dependency
 * in the system, and the contract is that a third party being down degrades an answer but
 * never breaks a turn.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./holidays");

const h = (await import(new URL("./holidays.ts", import.meta.url).href)) as Mod;

const SAMPLE = [
  { date: "2026-01-01", localName: "New Year's Day", name: "New Year's Day", global: true },
  { date: "2026-07-04", localName: "Independence Day", name: "Independence Day", global: true },
  { date: "2026-02-12", localName: "Lincoln's Birthday", name: "Lincoln's Birthday", global: false },
];

function fakeFetch(body: unknown, init: { ok?: boolean } = {}): typeof fetch {
  return (async () =>
    ({
      ok: init.ok ?? true,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

test("returns parsed holidays and reports a cold lookup", async () => {
  const cache = new Map();
  const res = await h.fetchPublicHolidays("US", 2026, { fetchImpl: fakeFetch(SAMPLE), cache });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.holidays.length, 3);
  assert.equal(res.cached, false);
  assert.equal(res.holidays[0]?.name, "New Year's Day");
  assert.equal(res.holidays[0]?.nationwide, true);
});

test("second lookup is served from cache without calling fetch", async () => {
  const cache = new Map();
  await h.fetchPublicHolidays("US", 2026, { fetchImpl: fakeFetch(SAMPLE), cache });

  let called = false;
  const spy = (async () => {
    called = true;
    throw new Error("must not be called");
  }) as unknown as typeof fetch;

  const res = await h.fetchPublicHolidays("US", 2026, { fetchImpl: spy, cache });
  assert.equal(called, false);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.cached, true);
});

test("lowercase country is normalised rather than rejected", async () => {
  const res = await h.fetchPublicHolidays("us", 2026, {
    fetchImpl: fakeFetch(SAMPLE),
    cache: new Map(),
  });
  assert.equal(res.country, "US");
  assert.equal(res.ok, true);
});

test("a bad country code never reaches the network", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return {} as Response;
  }) as unknown as typeof fetch;

  for (const bad of ["", "U", "USA", "12", "../../etc"]) {
    const res = await h.fetchPublicHolidays(bad, 2026, { fetchImpl: spy, cache: new Map() });
    assert.equal(res.ok, false, bad);
    if (!res.ok) assert.equal(res.reason, "invalid_country", bad);
  }
  assert.equal(called, false);
});

test("an upstream error degrades instead of throwing", async () => {
  const res = await h.fetchPublicHolidays("US", 2026, {
    fetchImpl: fakeFetch(null, { ok: false }),
    cache: new Map(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "upstream_error");
});

test("an unreachable host degrades instead of throwing", async () => {
  const boom = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const res = await h.fetchPublicHolidays("US", 2026, { fetchImpl: boom, cache: new Map() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "unreachable");
});

test("a timeout is reported as a timeout, not a generic failure", async () => {
  const hang = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as unknown as typeof fetch;

  const res = await h.fetchPublicHolidays("US", 2026, {
    fetchImpl: hang,
    timeoutMs: 10,
    cache: new Map(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "timeout");
});

test("a malformed payload is rejected rather than half-trusted", async () => {
  const res = await h.fetchPublicHolidays("US", 2026, {
    fetchImpl: fakeFetch({ not: "an array" }),
    cache: new Map(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "malformed_response");
});

test("junk entries are dropped but good ones survive", async () => {
  const res = await h.fetchPublicHolidays("US", 2026, {
    fetchImpl: fakeFetch([
      { date: "not-a-date", name: "Bad" },
      { date: "2026-01-01", name: "" },
      null,
      "string",
      { date: "2026-12-25", name: "Christmas Day" },
    ]),
    cache: new Map(),
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.holidays.length, 1);
  assert.equal(res.holidays[0]?.name, "Christmas Day");
});

test("a holiday missing `global` is treated as regional, not nationwide", async () => {
  const res = await h.fetchPublicHolidays("US", 2026, {
    fetchImpl: fakeFetch([{ date: "2026-01-01", name: "Ambiguous" }]),
    cache: new Map(),
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.holidays[0]?.nationwide, false);
});

test("upcomingFrom filters to on-or-after asOf, soonest first", () => {
  const parsed = [
    { date: "2026-07-04", name: "Independence Day", localName: "Independence Day", nationwide: true },
    { date: "2026-01-01", name: "New Year's Day", localName: "New Year's Day", nationwide: true },
    { date: "2026-12-25", name: "Christmas Day", localName: "Christmas Day", nationwide: true },
  ];
  const out = h.upcomingFrom(parsed, "2026-06-01");
  assert.deepEqual(out.map((x) => x.date), ["2026-07-04", "2026-12-25"]);
});

test("upcomingFrom includes a holiday falling exactly on asOf", () => {
  const parsed = [
    { date: "2026-07-04", name: "Independence Day", localName: "Independence Day", nationwide: true },
  ];
  assert.equal(h.upcomingFrom(parsed, "2026-07-04").length, 1);
});

test("upcomingFrom respects the limit", () => {
  const parsed = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"].map((date) => ({
    date,
    name: date,
    localName: date,
    nationwide: true,
  }));
  assert.equal(h.upcomingFrom(parsed, "2025-12-01", 2).length, 2);
});

test("daysUntil counts whole days and handles the past", () => {
  assert.equal(h.daysUntil("2026-08-25", "2026-08-25"), 0);
  assert.equal(h.daysUntil("2026-08-25", "2026-08-28"), 3);
  assert.equal(h.daysUntil("2026-08-25", "2026-08-24"), -1);
  assert.equal(h.daysUntil("garbage", "2026-08-24"), 0);
});

test("the fixture's non-ISO `UK` is mapped to `GB`, not sent upstream as-is", async () => {
  let seen = "";
  const spy = (async (url: string) => {
    seen = url;
    return { ok: true, json: async () => [] } as unknown as Response;
  }) as unknown as typeof fetch;

  const res = await h.fetchPublicHolidays("uk", 2026, { fetchImpl: spy, cache: new Map() });
  assert.equal(res.country, "GB");
  assert.match(seen, /\/PublicHolidays\/2026\/GB$/);
});

test("normalizeCountryCode maps aliases, passes ISO codes, and rejects non-countries", () => {
  assert.equal(h.normalizeCountryCode("UK"), "GB");
  assert.equal(h.normalizeCountryCode(" uk "), "GB");
  assert.equal(h.normalizeCountryCode("us"), "US");
  assert.equal(h.normalizeCountryCode("other"), null);
  assert.equal(h.normalizeCountryCode(""), null);
  assert.equal(h.normalizeCountryCode(null), null);
  assert.equal(h.normalizeCountryCode(undefined), null);
});

test("a holiday listed both regionally and nationwide collapses to one nationwide entry", () => {
  // Exactly what a live US lookup returns for Columbus Day.
  const parsed = [
    { date: "2026-10-12", name: "Columbus Day", localName: "Columbus Day", nationwide: false },
    { date: "2026-10-12", name: "Columbus Day", localName: "Columbus Day", nationwide: true },
    { date: "2026-09-07", name: "Labour Day", localName: "Labor Day", nationwide: true },
  ];
  const out = h.upcomingFrom(parsed, "2026-08-25");
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.date), ["2026-09-07", "2026-10-12"]);
  assert.equal(out[1]?.nationwide, true);
});

test("dedupe keeps the nationwide variant regardless of arrival order", () => {
  const parsed = [
    { date: "2026-10-12", name: "Columbus Day", localName: "Columbus Day", nationwide: true },
    { date: "2026-10-12", name: "Columbus Day", localName: "Columbus Day", nationwide: false },
  ];
  const out = h.upcomingFrom(parsed, "2026-01-01");
  assert.equal(out.length, 1);
  assert.equal(out[0]?.nationwide, true);
});

test("same date but genuinely different holidays are both kept", () => {
  const parsed = [
    { date: "2026-12-25", name: "Christmas Day", localName: "Christmas Day", nationwide: true },
    { date: "2026-12-25", name: "Quaid-e-Azam Day", localName: "Quaid-e-Azam Day", nationwide: true },
  ];
  assert.equal(h.upcomingFrom(parsed, "2026-01-01").length, 2);
});
