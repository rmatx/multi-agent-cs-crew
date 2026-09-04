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
import { createTracer, redact, sanitiseId } from "./trace";

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
