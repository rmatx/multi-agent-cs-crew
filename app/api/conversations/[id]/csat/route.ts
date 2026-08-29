/**
 * POST /api/conversations/:id/csat — record a CSAT response (PRD F-CSAT-01).
 *
 * The `csat_prompt` frame asks the question; this is where the answer goes. Without it the
 * `csat_score` column could never be written and the prompt would be theatre.
 *
 * Unauthenticated, like `POST /api/chat` and for the same reason: it is a customer surface on
 * a localhost MVP. It is also the least valuable thing in the system to forge — the worst a
 * caller can do is rate their own conversation, and the write is an overwrite keyed on a
 * conversation id they must already know.
 */

import { recordCsat } from "@/server/runtime/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "invalid_json", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const payload = body as { score?: unknown; comment?: unknown };
  if (typeof payload.score !== "number") {
    return Response.json(
      { code: "invalid_request", message: "`score` is required and must be a number 1-5." },
      { status: 400 },
    );
  }
  if (payload.comment !== undefined && typeof payload.comment !== "string") {
    return Response.json(
      { code: "invalid_request", message: "`comment` must be a string when present." },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const result = recordCsat(id, payload.score, payload.comment);
  if (!result.ok) {
    return Response.json(
      { code: result.code, message: result.message },
      { status: result.code === "unknown_conversation" ? 404 : 400 },
    );
  }

  return Response.json({ status: "ok" });
}
