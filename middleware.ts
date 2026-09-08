/**
 * Password gate for the reviewer surface (`/final` and the run sheet it links to), and the
 * place the reviewer cookie is minted.
 *
 * HTTP Basic, deliberately. It is ~40 lines with no login page, no POST route, no cookie and
 * no session store, and — the reason it was chosen over a prettier form — the browser sends the
 * header on the .xlsx request too, so the workbook is covered by the same check as the page
 * without a second mechanism that could disagree with the first. The username is not checked;
 * there is one password and no accounts to have.
 *
 * On success it also sets the reviewer cookie, which is the ONLY thing that upgrades a turn to
 * the live crew — see `server/runtime/demoGate.ts`. `/api/chat` stays open to everyone, but an
 * ungated caller gets the keyless deterministic engine and therefore cannot spend the API key.
 *
 * WHAT THIS IS NOT: authentication. It is a shared password on a demo link. It gates which
 * ENGINE answers, never who may read what — SEC-01 and SEC-02 are untouched, and this is not
 * the auth story the project still owes (see the post-demo notes).
 *
 * FAILS CLOSED. With `FINAL_DEMO_PASSWORD` unset the gate denies rather than opens: the whole
 * point of the variable is that the secret is not in this repo, and a gate that swings open
 * when its secret is missing is worse than no gate, because the deploy still looks protected.
 */

import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, requestPassedGate } from "@/server/runtime/demoGate";

const REALM = 'Basic realm="NovaMart reviewer build", charset="UTF-8"';

function challenge(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      // A 401 for a gated page must never be cached, by the browser or by anything in front
      // of it — a cached challenge locks out someone who then types the right password.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Length-independent comparison. Basic auth over TLS on a demo link is not a realistic timing
 * target, but a short-circuiting `===` on a secret is the kind of thing that gets copied into
 * somewhere it does matter.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Compare a fixed number of bytes regardless of input, then fold in the length check.
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.FINAL_DEMO_PASSWORD?.trim();
  if (expected === undefined || expected.length === 0) {
    console.error(
      "FINAL_DEMO_PASSWORD is not set: refusing to serve the reviewer build. Set it in the " +
        "deployment's variables — it is intentionally not committed.",
    );
    return challenge();
  }

  /*
   * The cookie is accepted as proof, not only the Authorization header — and this is a fix, not
   * a convenience. The Basic protection space covers paths at or below the authenticated URI,
   * and the run sheet lives at `/novamart-demo-runsheet.xlsx`: a SIBLING of `/final`, not a
   * child. A browser therefore does not send the credentials it already holds when the reviewer
   * clicks the download, and the gate answered 401 to someone who had just typed the password
   * correctly. Same root cause as the one `demoGate.ts` describes for `/api/chat`; it applies to
   * every gated path that is not nested under `/final`.
   *
   * Checked BEFORE the header so the common case — a reviewer who authenticated a moment ago —
   * costs one digest and no challenge round-trip.
   */
  if (await requestPassedGate(request)) return pass(request, expected);

  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith("Basic ")) return challenge();

  let decoded: string;
  try {
    // `atob` rather than Buffer: middleware runs on the edge runtime, where Buffer is absent.
    decoded = atob(header.slice("Basic ".length).trim());
  } catch {
    // Malformed base64 is a failed attempt, not a server error.
    return challenge();
  }

  // Split on the FIRST colon only. A password containing a colon is legal and would otherwise
  // be silently truncated into a password that never matches.
  const separator = decoded.indexOf(":");
  const supplied = separator === -1 ? "" : decoded.slice(separator + 1);

  if (!constantTimeEqual(supplied, expected)) return challenge();

  return pass(request, expected);
}

/**
 * The allow path: continue, refuse caching, and (re)mint the reviewer cookie.
 *
 * Shared by both ways in so a session that arrived by cookie keeps getting its expiry extended
 * exactly as one that arrived by password does — otherwise a reviewer's twelve hours would
 * start expiring from their first request rather than their last.
 */
async function pass(request: NextRequest, password: string): Promise<NextResponse> {
  const response = NextResponse.next();
  // Belt and braces alongside the app's Referrer-Policy: nothing behind the gate should be
  // held by a shared cache that does not know the gate exists.
  response.headers.set("Cache-Control", "no-store");

  /*
   * Carry the proof to `/api/chat`, which is what decides whether this visitor's turns run the
   * live crew or the public keyless engine (`server/runtime/demoGate.ts` explains why the
   * Authorization header cannot do this job: `/api/chat` is a SIBLING of `/final`, so the
   * browser never sends Basic credentials there).
   *
   * `path: "/"` because the endpoints that read it are not under `/final`. `httpOnly` so page
   * scripts cannot read it, `sameSite: lax` so it survives following a link into the demo but
   * is not sent from a third-party form post, and `secure` everywhere except plain-HTTP local
   * development — a Secure cookie is silently dropped over http://localhost's non-TLS origin,
   * which would make the whole gate appear broken only when developing.
   */
  response.cookies.set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export const config = {
  /*
   * Static, analysable literals: Next reads this at build time and cannot evaluate a variable
   * or an expression here, which is why the list is not shared with the constant in
   * `components/ReviewerHeader.tsx` that names the same .xlsx path. If that filename ever
   * changes, this matcher is the second place to change, and a gate pointed at the old name
   * would leave the new one served to anyone.
   */
  matcher: ["/final", "/final/:path*", "/novamart-demo-runsheet.xlsx"],
};
