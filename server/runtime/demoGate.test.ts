/**
 * Reviewer-gate tests.
 *
 * What is worth pinning here is not that the happy path works — it is that every way of NOT
 * presenting a valid cookie lands on the public engine rather than the paid one, and that the
 * cookie never carries the password itself. A gate that fails open is a bill; a cookie that
 * leaks the password is a gate that only had to be stolen once.
 */

import assert from "node:assert/strict";
import test from "node:test";

type Mod = typeof import("./demoGate");

const gate = (await import(new URL("./demoGate.ts", import.meta.url).href)) as Mod;

const PASSWORD = "MavenDemo$";

function withCookie(value: string | null): Request {
  return new Request("https://example.test/api/chat", {
    headers: value === null ? {} : { cookie: value },
  });
}

test("a valid cookie passes the gate", async () => {
  process.env.FINAL_DEMO_PASSWORD = PASSWORD;
  const token = await gate.gateToken(PASSWORD);
  assert.equal(await gate.requestPassedGate(withCookie(`${gate.GATE_COOKIE}=${token}`)), true);
});

test("no cookie, wrong cookie, and empty cookie all fall back to the public engine", async () => {
  process.env.FINAL_DEMO_PASSWORD = PASSWORD;
  assert.equal(await gate.requestPassedGate(withCookie(null)), false, "no cookie header");
  assert.equal(await gate.requestPassedGate(withCookie("")), false, "empty cookie header");
  assert.equal(
    await gate.requestPassedGate(withCookie(`${gate.GATE_COOKIE}=deadbeef`)),
    false,
    "wrong digest",
  );
  assert.equal(
    await gate.requestPassedGate(withCookie("somethingelse=whatever")),
    false,
    "unrelated cookie",
  );
});

test("the password itself is not accepted as the cookie value", async () => {
  // The cookie carries a digest. If a raw password were ever accepted here, anyone who saw the
  // password could forge the cookie without the digest step — and, worse, it would mean the
  // digest was decorative.
  process.env.FINAL_DEMO_PASSWORD = PASSWORD;
  assert.equal(await gate.requestPassedGate(withCookie(`${gate.GATE_COOKIE}=${PASSWORD}`)), false);
});

test("the cookie never contains the password", async () => {
  const token = await gate.gateToken(PASSWORD);
  assert.ok(!token.includes(PASSWORD), "digest must not embed the password");
  assert.match(token, /^[0-9a-f]{64}$/, "SHA-256 hex");
});

test("FAILS CLOSED: with no configured password, nothing is ever privileged", async () => {
  // The important direction. An unset variable must not mean "let everyone run the crew" —
  // that would turn a misconfigured deploy into an open tab on the operator's API key.
  const token = await gate.gateToken(PASSWORD);
  delete process.env.FINAL_DEMO_PASSWORD;
  assert.equal(await gate.requestPassedGate(withCookie(`${gate.GATE_COOKIE}=${token}`)), false);
  process.env.FINAL_DEMO_PASSWORD = "   ";
  assert.equal(
    await gate.requestPassedGate(withCookie(`${gate.GATE_COOKIE}=${token}`)),
    false,
    "whitespace-only is unset",
  );
});

test("rotating the password invalidates outstanding cookies", async () => {
  process.env.FINAL_DEMO_PASSWORD = PASSWORD;
  const old = await gate.gateToken(PASSWORD);
  process.env.FINAL_DEMO_PASSWORD = "SomethingElse1!";
  assert.equal(await gate.requestPassedGate(withCookie(`${gate.GATE_COOKIE}=${old}`)), false);
});

test("cookie parsing survives the shapes a real browser sends", () => {
  const name = gate.GATE_COOKIE;
  assert.equal(gate.readCookie(`${name}=abc`, name), "abc");
  assert.equal(gate.readCookie(`other=1; ${name}=abc; third=2`, name), "abc", "middle of a list");
  assert.equal(gate.readCookie(`  ${name}=abc  `, name), "abc", "surrounding whitespace");
  // A value containing '=' must survive whole: splitting on every '=' would truncate padded
  // base64 into something that can never match.
  assert.equal(gate.readCookie(`${name}=a=b=c`, name), "a=b=c");
  assert.equal(gate.readCookie(`${name}x=abc`, name), undefined, "prefix must not match");
  assert.equal(gate.readCookie(`x${name}=abc`, name), undefined, "suffix must not match");
  assert.equal(gate.readCookie(null, name), undefined);
  assert.equal(gate.readCookie("malformed", name), undefined);
});

test("constant-time compare still compares", () => {
  assert.equal(gate.constantTimeEqual("abc", "abc"), true);
  assert.equal(gate.constantTimeEqual("abc", "abd"), false);
  assert.equal(gate.constantTimeEqual("abc", "abcd"), false, "length differences count");
  assert.equal(gate.constantTimeEqual("", ""), true);
});
