/**
 * GET /api/tickets/<ticketStubId>/email — the simulated handoff email for one ticket (ENH-01).
 *
 * Returns the text that was ALREADY WRITTEN to `data/tickets/<id>.md`, never a fresh rendering.
 * Two reasons. A regenerated copy could disagree with the artifact, and the whole point of
 * showing it is that the audience sees what a human receives. And the stored copy went through
 * `scrubPii` on the way to disk (SEC-03); a copy built here would not.
 *
 * DEMO-GATED, SERVER-SIDE. `DEMO_MODE=1` is set by `scripts/demo.sh` and unset everywhere else,
 * so this route 404s in any normal deployment. The gate is deliberately NOT the client's
 * `NEXT_PUBLIC_DEMO_MODE` — that is a build-time value visible in the browser bundle and
 * therefore not a control at all. This serves customer content, so it needs a real one.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same shape `createTicketStub` mints: STUB- plus 8 hex. Anything else never touches the disk. */
const TICKET_ID = /^STUB-[0-9A-F]{8}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (process.env["DEMO_MODE"] !== "1") {
    return Response.json({ code: "not_found" }, { status: 404 });
  }

  const { id } = await params;
  // Validated rather than sanitised: the id format is fixed and narrow, so a value that does not
  // match it is not a ticket id at all and has no business being joined onto a path.
  if (!TICKET_ID.test(id)) {
    return Response.json({ code: "invalid_ticket_id" }, { status: 400 });
  }

  try {
    const text = await readFile(
      path.join(process.cwd(), "data", "tickets", `${id}.md`),
      "utf8",
    );
    return Response.json({ ticketStubId: id, text });
  } catch {
    // The artifact write is best-effort and not awaited on the turn's hot path, so a ticket can
    // exist for a moment before its file does. Absence is a normal state, not an error.
    return Response.json({ code: "not_ready" }, { status: 404 });
  }
}
