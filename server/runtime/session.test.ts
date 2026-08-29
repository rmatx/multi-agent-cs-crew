/**
 * SessionStore + durable TicketStubStore (ADR-10).
 *
 * Runs against a REAL SQLite file in a temp directory, not a mock. The claims being tested —
 * a ticket survives a restart, a replayed turn does not open a second one — are claims about
 * the database, and a mock would assert only that the code calls the functions it calls.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "novamart-session-"));
process.env.SESSION_DB_PATH = path.join(dir, "sessions.sqlite");
process.env.TICKET_STUB_DB_PATH = path.join(dir, "stubs.sqlite");

type SessionMod = typeof import("./session");
type EscalationMod = typeof import("./escalation");
type SqliteMod = typeof import("../data/sqlite");

const session = (await import(new URL("./session.ts", import.meta.url).href)) as SessionMod;
const escalation = (await import(
  new URL("./escalation.ts", import.meta.url).href
)) as EscalationMod;
const sqlite = (await import(new URL("../data/sqlite.ts", import.meta.url).href)) as SqliteMod;

test.after(() => {
  sqlite.resetSqliteForTests();
  rmSync(dir, { recursive: true, force: true });
});

const pkg = (conversationId: string, reason = "payment_or_refund") => ({
  conversationId,
  intent: "payment_question",
  entities: { order_id: 46101 },
  urgency: "medium" as const,
  transcript_summary: "Customer asked for a refund.",
  tools_tried: [{ tool: "get_order", ok: true, summary: "Order 46101 is completed." }],
  citations: ["duckdb:orders:46101"],
  reason_code: reason,
  suggested_category: "billing",
});

test("a conversation remembers what was said", () => {
  session.ensureSession("conv-1");
  session.appendMessage("conv-1", "user", "Where is my order?");
  session.appendMessage("conv-1", "assistant", "Order 46101 is completed.", "resolved");
  session.appendMessage("conv-1", "user", "Can I return it?");

  const loaded = session.loadSession("conv-1");
  assert.equal(loaded.transcript.length, 3);
  assert.equal(loaded.transcript[0]?.role, "user");
  assert.equal(loaded.transcript[1]?.status, "resolved");
  assert.equal(loaded.transcript[2]?.content, "Can I return it?");
});

test("identity given once carries forward, and a new id replaces it", () => {
  session.ensureSession("conv-2");
  session.saveIdentity("conv-2", { orderId: 46101 });

  // Turn 2 supplies nothing: the stored id still applies.
  const carried = session.mergeIdentity(session.loadSession("conv-2").identity, {});
  assert.deepEqual(carried, { orderId: 46101 });

  // Turn 3 names a different order: the customer changed the subject, so the request wins.
  const replaced = session.mergeIdentity(session.loadSession("conv-2").identity, { orderId: 1 });
  assert.deepEqual(replaced, { orderId: 1 });

  // A user id arriving later joins the order id rather than replacing it.
  session.saveIdentity("conv-2", { orderId: 46101, userId: 38 });
  assert.deepEqual(session.loadSession("conv-2").identity, { userId: 38, orderId: 46101 });
});

test("AC-TICKET-01: app context is remembered across turns and never erased", () => {
  session.ensureSession("conv-app");
  let ctx = session.loadSession("conv-app").appContext;
  assert.deepEqual(ctx, {}, "nothing stated yet");

  // Turn 1: the customer describes the crash.
  ctx = session.rememberAppContext("conv-app", ctx, { device: "android", app_version: "3.2.0" });
  assert.deepEqual(ctx, { device: "android", app_version: "3.2.0" });
  assert.deepEqual(session.loadSession("conv-app").appContext, {
    device: "android",
    app_version: "3.2.0",
  });

  // Turn 2 mentions neither — the escalation two turns later still needs them.
  ctx = session.rememberAppContext("conv-app", ctx, {});
  assert.deepEqual(ctx, { device: "android", app_version: "3.2.0" });

  // Turn 3 corrects the version: newer wins, device survives.
  ctx = session.rememberAppContext("conv-app", ctx, { app_version: "3.2.1" });
  assert.deepEqual(ctx, { device: "android", app_version: "3.2.1" });
  assert.deepEqual(session.loadSession("conv-app").appContext, {
    device: "android",
    app_version: "3.2.1",
  });
});

test("empty assistant text is not stored as a turn", () => {
  session.ensureSession("conv-3");
  session.appendMessage("conv-3", "assistant", "   ");
  assert.equal(session.loadSession("conv-3").transcript.length, 0);
});

test("the transcript window is bounded", () => {
  session.ensureSession("conv-4");
  for (let i = 0; i < 60; i += 1) {
    session.appendMessage("conv-4", "user", `message ${i}`);
  }
  const loaded = session.loadSession("conv-4");
  assert.ok(loaded.transcript.length <= 24, `got ${loaded.transcript.length}`);
  // The window must keep the RECENT end — the oldest messages are the ones to drop.
  assert.equal(loaded.transcript.at(-1)?.content, "message 59");
});

test("CSAT is recorded, validated, and overwritten rather than duplicated", () => {
  session.ensureSession("conv-5");
  assert.equal(session.recordCsat("conv-5", 4).ok, true);
  assert.equal(session.getCsat("conv-5")?.score, 4);

  assert.equal(session.recordCsat("conv-5", 5, "sorted quickly").ok, true);
  assert.equal(session.getCsat("conv-5")?.score, 5);
  assert.equal(session.getCsat("conv-5")?.comment, "sorted quickly");

  for (const bad of [0, 6, 2.5]) {
    const result = session.recordCsat("conv-5", bad);
    assert.equal(result.ok, false, `score ${bad} should be rejected`);
  }
  assert.equal(session.recordCsat("nope", 3).ok, false);
});

test("a ticket stub is durable and readable back", () => {
  const created = escalation.createTicketStub(pkg("conv-6"), { asOf: "2026-09-01" });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const read = escalation.getTicketStub(created.ticket_stub_id);
  assert.equal(read?.conversationId, "conv-6");
  assert.equal(read?.reason_code, "payment_or_refund");
  // Round-tripped through JSON columns — the shape the eval asserts must survive storage.
  assert.deepEqual(read?.entities, { order_id: 46101 });
  assert.deepEqual(read?.citations, ["duckdb:orders:46101"]);
  assert.equal(read?.tools_tried[0]?.tool, "get_order");
  assert.equal(read?.created_at, "2026-09-01T00:00:00.000Z");
});

test("a replayed turn does not open a second ticket", () => {
  const first = escalation.createTicketStub(pkg("conv-7"), { asOf: "2026-09-01" });
  const second = escalation.createTicketStub(pkg("conv-7"), { asOf: "2026-09-01" });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.ticket_stub_id, second.ticket_stub_id);

  // A DIFFERENT reason on the same conversation is a different ticket — idempotency is keyed
  // on both, so a refund ask and a later cancellation ask are not collapsed into one.
  const other = escalation.createTicketStub(pkg("conv-7", "restricted_action"), {
    asOf: "2026-09-01",
  });
  assert.equal(other.ok, true);
  if (!other.ok) return;
  assert.notEqual(other.ticket_stub_id, first.ticket_stub_id);
  assert.equal(escalation.listTicketStubsForConversation("conv-7").length, 2);
});

test("an incomplete package is still rejected rather than stored", () => {
  const bad = { ...pkg("conv-8"), transcript_summary: "" };
  const result = escalation.createTicketStub(bad, { asOf: "2026-09-01" });
  assert.equal(result.ok, false);
  assert.equal(escalation.listTicketStubsForConversation("conv-8").length, 0);
});
