/**
 * Redaction boundary for the trace log.
 *
 * The interesting tests here are the ones that pull in OPPOSITE directions. `redact()` has to
 * keep token USAGE (so per-turn cost is attributable) while still destroying token
 * CREDENTIALS, and those two live one underscore apart: `input_tokens` vs `auth_token`. Every
 * test below exists because loosening the first without loosening the second is the whole
 * trick — a regression in either direction is silent on disk, which is the worst place for it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createTracer, redact, resolveLogDir, resolveRetentionDays, sanitiseId } from "./trace";

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

test("usage counts survive redaction so cost stays attributable", () => {
  const out = asRecord(
    redact({
      input_tokens: 1234,
      output_tokens: 56,
      cache_read_input_tokens: 7890,
      cache_creation_input_tokens: 0,
    }),
  );

  assert.equal(out["input_tokens"], 1234);
  assert.equal(out["output_tokens"], 56);
  assert.equal(out["cache_read_input_tokens"], 7890);
  assert.equal(out["cache_creation_input_tokens"], 0);
});

test("nested usage containers are recursed into, not redacted wholesale", () => {
  const out = asRecord(
    redact({
      cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 20 },
      output_tokens_details: { rejected_prediction_tokens: 3 },
    }),
  );

  assert.deepEqual(out["cache_creation"], {
    ephemeral_1h_input_tokens: 10,
    ephemeral_5m_input_tokens: 20,
  });
  assert.deepEqual(out["output_tokens_details"], { rejected_prediction_tokens: 3 });
});

test("camelCase counts survive too — the codebase uses both conventions", () => {
  // `budgets.maxOutputTokens` and `response.totalTokens` are ours; the snake_case ones are the
  // SDK's. Both were redacted before, which is why the budget in a Prompt Trace read as a
  // secret.
  const out = asRecord(redact({ maxOutputTokens: 4096, maxThinkingTokens: 1024, totalTokens: 77 }));
  assert.equal(out["maxOutputTokens"], 4096);
  assert.equal(out["maxThinkingTokens"], 1024);
  assert.equal(out["totalTokens"], 77);
});

test("singular token keys stay redacted in either convention", () => {
  const out = asRecord(
    redact({ accessToken: "abcdefghijklmnop", authToken: "abcdefghijklmnop", apiToken: "abcdefghijklmnop" }),
  );
  assert.equal(out["accessToken"], "[REDACTED]");
  assert.equal(out["authToken"], "[REDACTED]");
  assert.equal(out["apiToken"], "[REDACTED]");
});

test("credentials are still destroyed, including the token-shaped ones", () => {
  const out = asRecord(
    redact({
      ANTHROPIC_API_KEY: "sk-ant-abcdefghijklmnop",
      api_key: "sk-ant-abcdefghijklmnop",
      access_token: "abcdefghijklmnop",
      refresh_token: "abcdefghijklmnop",
      auth_token: "abcdefghijklmnop",
      authorization: "Bearer abcdefghijklmnop",
      password: "hunter2",
      secret: "s3cret",
      credential: "c",
    }),
  );

  for (const key of Object.keys(out)) {
    assert.equal(out[key], "[REDACTED]", `${key} must be redacted`);
  }
});

test("a secret mis-named as a count is still redacted, because it is a string", () => {
  // The exemption requires a non-string value precisely so this case cannot leak.
  const out = asRecord(redact({ tokens: "sk-ant-abcdefghijklmnop" }));
  assert.equal(out["tokens"], "[REDACTED]");
});

test("provider keys are scrubbed from values regardless of the key name", () => {
  const out = asRecord(
    redact({ note: "call failed with sk-ant-abcdefghijklmnop", head: "Bearer abcdefghijklmnop" }),
  );
  assert.match(String(out["note"]), /\[REDACTED\]/);
  assert.match(String(out["head"]), /\[REDACTED\]/);
});

test("the usage block the SDK actually reports round-trips with counts intact", () => {
  // Shape copied from a real turn_result record, which is what regressed.
  const usage = {
    input_tokens: 4,
    cache_creation_input_tokens: 21_000,
    cache_read_input_tokens: 0,
    output_tokens: 180,
    server_tool_use: { web_search_requests: 0 },
    service_tier: "standard",
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 21_000 },
  };

  const out = asRecord(redact(usage));
  assert.equal(out["input_tokens"], 4);
  assert.equal(out["cache_creation_input_tokens"], 21_000);
  assert.equal(out["output_tokens"], 180);
  assert.equal(asRecord(out["cache_creation"])["ephemeral_5m_input_tokens"], 21_000);
  // Non-usage fields are untouched by any of this.
  assert.equal(out["service_tier"], "standard");
});

test("long strings are truncated and depth is bounded", () => {
  const long = asRecord(redact({ text: "x".repeat(3000) }));
  assert.match(String(long["text"]), /…\[truncated\]$/);

  let deep: unknown = "bottom";
  for (let i = 0; i < 10; i += 1) deep = { nested: deep };
  assert.match(JSON.stringify(redact(deep)), /depth-limit/);
});

test("sanitiseId cannot climb out of the log directory", () => {
  assert.equal(sanitiseId("../../etc/passwd"), ".._.._etc_passwd");
  assert.equal(sanitiseId(""), "unknown");
  assert.equal(sanitiseId("a/b\\c"), "a_b_c");
});

test("each turn gets its own correlation id, stable within the turn", () => {
  // One tracer is created per turn (sdk.ts runTurn), so tracer identity IS turn identity.
  const a = createTracer("conv-1", "sdk");
  const b = createTracer("conv-1", "sdk");

  assert.match(a.turnId, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.turnId, b.turnId, "two turns of one conversation must not share an id");
  assert.equal(a.turnId, a.turnId, "the id is stable for the life of the turn");
  assert.equal(a.conversationId, b.conversationId);
});

/*
 * PII scrubbing (SEC-03). The failure mode to guard is not "a pattern was missed" but "the log
 * became useless": these tests pull in both directions, exactly like the token/credential pair
 * above. Contact details go; the sentence and the ids that make a turn reconstructable stay.
 */

test("contact details are scrubbed out of customer text", () => {
  const out = String(
    asRecord(redact({ userPrompt: "email me at raj.mani+support@example.co.uk or call (555) 123-4567" }))[
      "userPrompt"
    ],
  );
  assert.match(out, /\[EMAIL\]/);
  assert.match(out, /\[PHONE\]/);
  assert.doesNotMatch(out, /example\.co\.uk/);
  assert.doesNotMatch(out, /123-4567/);
});

test("a card number is scrubbed, and a long non-card number is not", () => {
  // 4242…4242 is the canonical Luhn-valid test card.
  assert.match(String(asRecord(redact({ t: "my card is 4242 4242 4242 4242" }))["t"]), /\[CARD\]/);
  // Same length, fails Luhn — an id or a reference, and mangling it would lose real debug data.
  const notACard = String(asRecord(redact({ t: "reference 1234567812345678" }))["t"]);
  assert.match(notACard, /1234567812345678/);
});

test("the ids a trace is read by survive — this is what makes the log still worth keeping", () => {
  const out = String(asRecord(redact({ t: "order 46101 for user 49890 totalling $175.05, placed 2026-09-01" }))["t"]);
  assert.match(out, /46101/);
  assert.match(out, /49890/);
  assert.match(out, /\$175\.05/);
  assert.match(out, /2026-09-01/);
});

test("scrubbing composes with secret redaction rather than replacing it", () => {
  const out = String(asRecord(redact({ t: "key sk-ant-abcdefghijklmnop and mail a@b.co" }))["t"]);
  assert.match(out, /\[REDACTED\]/);
  assert.match(out, /\[EMAIL\]/);
});

test("retention window: default, explicit zero, and a bad value that must not delete everything", () => {
  const read = (value: string | undefined): number => {
    const prev = process.env["TRACE_RETENTION_DAYS"];
    if (value === undefined) delete process.env["TRACE_RETENTION_DAYS"];
    else process.env["TRACE_RETENTION_DAYS"] = value;
    try {
      return resolveRetentionDays();
    } finally {
      if (prev === undefined) delete process.env["TRACE_RETENTION_DAYS"];
      else process.env["TRACE_RETENTION_DAYS"] = prev;
    }
  };

  assert.equal(read(undefined), 7);
  assert.equal(read("30"), 30);
  assert.equal(read("0"), 0, "an explicit 0 is a real operator choice (DEF-07)");
  assert.equal(read("-5"), 7, "a negative must fall back, not delete the archive");
  assert.equal(read("soon"), 7, "a typo must fall back, not delete the archive");
});

test("PII at the end of a sentence is still scrubbed, whole", () => {
  // Regression: `(?![\d.])` rejected a number followed by a full stop, so a sentence-final card
  // fell through to the phone rule and leaked its last group as "[PHONE] 4242".
  const out = String(asRecord(redact({ t: "charge card 4242 4242 4242 4242. Thanks." }))["t"]);
  assert.match(out, /\[CARD\]/);
  assert.doesNotMatch(out, /4242/);

  const phone = String(asRecord(redact({ t: "call 555-987-6543." }))["t"]);
  assert.match(phone, /\[PHONE\]/);
  assert.doesNotMatch(phone, /6543/);
});

test("TRACE_LOG_DIR redirects the trace directory, and only when it says something", () => {
  const read = (value: string | undefined): string => {
    const prev = process.env["TRACE_LOG_DIR"];
    if (value === undefined) delete process.env["TRACE_LOG_DIR"];
    else process.env["TRACE_LOG_DIR"] = value;
    try {
      return resolveLogDir();
    } finally {
      if (prev === undefined) delete process.env["TRACE_LOG_DIR"];
      else process.env["TRACE_LOG_DIR"] = prev;
    }
  };

  const repoDefault = path.join(process.cwd(), "project-context", "2.build", "logs");
  assert.equal(read(undefined), repoDefault, "unset keeps the repo-relative default");
  assert.equal(read(""), repoDefault, "an empty value is not a path");
  assert.equal(read("   "), repoDefault, "nor is whitespace");
  // The container case this exists for: traces must land inside the mounted volume, or they
  // are lost on the next redeploy.
  assert.equal(read("/app/data/logs"), "/app/data/logs");
  // Relative values resolve against cwd rather than being used raw, so a stray "logs" cannot
  // write to a path that depends on which directory the process happened to start in.
  assert.equal(read("logs"), path.join(process.cwd(), "logs"));
});
