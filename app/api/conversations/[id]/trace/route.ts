/**
 * GET /api/conversations/:id/trace — operator trace (SAD §4, F-TRACE-01).
 *
 * "Returns ordered hops for operator panel. Auth: MVP = local-only / shared demo secret header
 * `X-Operator-Key` from env."
 *
 * THIS IS THE ONLY AUTHENTICATED ENDPOINT IN THE SYSTEM, and it is authenticated because of
 * what it returns: the hop path, the tools called, the prompts, and the ticket stubs opened on
 * a conversation. `POST /api/chat` is the customer surface and shows a customer only their own
 * turn; this shows an operator the machinery behind it, including data the customer never sees.
 *
 * It FAILS CLOSED. With `OPERATOR_KEY` unset the endpoint returns 503 and reads nothing —
 * never "no key configured, so no check". An endpoint that becomes public the moment someone
 * forgets an env var is worse than one that is simply switched off, and this one ships in a
 * repo where `.env.local` is deliberately absent.
 */

import { readFile } from "node:fs/promises";
import { listTicketStubsForConversation } from "@/server/runtime/escalation";
import { getCsat, loadSession } from "@/server/runtime/session";
import { sanitiseId, traceLogPath } from "@/server/runtime/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trace records an operator reads as the hop path. Everything else is diagnostics. */
const HOP_EVENTS = new Set(["agent_hop", "tool_call", "tool_denied", "hop_budget_exhausted"]);

type TraceLine = Record<string, unknown> & { event?: string; ts?: string };

function unauthorized(message: string): Response {
  return Response.json({ code: "unauthorized", message }, { status: 401 });
}

/**
 * Constant-time-ish comparison. Not a defence against a serious attacker — this is a shared
 * demo secret on localhost — but string `===` on a secret is a habit worth not forming.
 */
function keyMatches(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i += 1) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const expected = process.env.OPERATOR_KEY?.trim();
  if (expected === undefined || expected.length === 0) {
    return Response.json(
      {
        code: "operator_key_unset",
        message:
          "Operator trace is disabled: OPERATOR_KEY is not set. Set it in .env.local to enable.",
      },
      { status: 503 },
    );
  }

  const supplied = request.headers.get("x-operator-key");
  if (supplied === null) return unauthorized("X-Operator-Key header is required.");
  if (!keyMatches(supplied, expected)) return unauthorized("Invalid operator key.");

  const { id } = await context.params;
  const conversationId = sanitiseId(id);

  let lines: TraceLine[] = [];
  try {
    const raw = await readFile(traceLogPath(conversationId), "utf8");
    lines = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TraceLine);
  } catch {
    // No trace file: either an unknown conversation or one served by the deterministic engine,
    // which makes no model calls and writes no trace. Both are 404 to an operator — there is
    // nothing to show — and neither is an error.
    lines = [];
  }

  const session = loadSession(conversationId);
  const stubs = listTicketStubsForConversation(conversationId);

  if (lines.length === 0 && session.transcript.length === 0 && stubs.length === 0) {
    return Response.json(
      { code: "not_found", message: `No conversation ${conversationId}.` },
      { status: 404 },
    );
  }

  const hops = lines
    .filter((line) => HOP_EVENTS.has(String(line.event)))
    .map((line) => ({
      ts: line.ts ?? null,
      event: line.event ?? null,
      agentId: line["agentId"] ?? line["agent_type"] ?? null,
      tool: line["tool"] ?? null,
      hop: line["hop"] ?? null,
      reason: line["reason"] ?? null,
    }));

  const turnResults = lines.filter((line) => line.event === "turn_result");

  return Response.json({
    conversationId,
    // Already redacted at write time (`trace.ts` runs `redact()` over every record), so this
    // endpoint never has to decide what is safe to show — it cannot leak what was never stored.
    hops,
    turns: turnResults.map((line) => ({
      ts: line.ts ?? null,
      hops: line["hops"] ?? null,
      path: line["path"] ?? null,
      numTurns: line["numTurns"] ?? null,
      costUsd: line["costUsd"] ?? null,
    })),
    transcript: session.transcript,
    identity: session.identity,
    csat: getCsat(conversationId),
    ticketStubs: stubs.map((stub) => ({
      ticket_stub_id: stub.ticket_stub_id,
      reason_code: stub.reason_code,
      urgency: stub.urgency,
      created_at: stub.created_at,
      // AC-TICKET-01: the context the ticket reached a human with. Ids and a device string —
      // no free text, so nothing here widens what §8 redaction already allows.
      entities: stub.entities,
      suggested_category: stub.suggested_category,
    })),
    traceRecordCount: lines.length,
  });
}
