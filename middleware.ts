/**
 * Password gate for the reviewer surface (`/final` and the run sheet it links to).
 *
 * HTTP Basic, deliberately. It is ~40 lines with no login page, no POST route, no cookie and
 * no session store, and — the reason it was chosen over a prettier form — the browser sends the
 * header on the .xlsx request too, so the workbook is covered by the same check as the page
 * without a second mechanism that could disagree with the first. The username is not checked;
 * there is one password and no accounts to have.
 *
 * WHAT THIS IS NOT: authentication. It is a shared password on a demo link. It does not protect
 * `/api/chat`, which stays open exactly as it is today, and it is not the auth story the
 * project still owes (see the post-demo notes). Anyone with the password has everything.
 *
 * FAILS CLOSED. With `FINAL_DEMO_PASSWORD` unset the gate denies rather than opens: the whole
 * point of the variable is that the secret is not in this repo, and a gate that swings open
 * when its secret is missing is worse than no gate, because the deploy still looks protected.
 */

import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(request: NextRequest): NextResponse {
  const expected = process.env.FINAL_DEMO_PASSWORD?.trim();
  if (expected === undefined || expected.length === 0) {
    console.error(
      "FINAL_DEMO_PASSWORD is not set: refusing to serve the reviewer build. Set it in the " +
        "deployment's variables — it is intentionally not committed.",
    );
    return challenge();
  }

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

  const response = NextResponse.next();
  // Belt and braces alongside the app's Referrer-Policy: nothing behind the gate should be
  // held by a shared cache that does not know the gate exists.
  response.headers.set("Cache-Control", "no-store");
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
