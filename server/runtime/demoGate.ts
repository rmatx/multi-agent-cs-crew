/**
 * The reviewer gate, and the one thing it is allowed to change about a turn.
 *
 * WHY THIS EXISTS. `CHAT_ENGINE` is process-wide, so arming the crew with it arms `/` and
 * `/api/chat` for the whole internet at once — on an API key that local dev and CI also share.
 * But `/` is the URL printed in a submission document that has already been handed in, and it
 * must keep answering for a grader who has no password. Those two facts rule out both obvious
 * options: leaving the site open with the crew on, and putting the whole site behind the
 * password.
 *
 * So the engine becomes a PER-REQUEST decision. A request that proves it came through the
 * reviewer gate runs the sdk crew; every other request runs whatever `CHAT_ENGINE` says, which
 * in the live deployment is the keyless deterministic engine. The public demo a grader opens is
 * byte-for-byte the one they were shown; the live crew costs nothing to a stranger.
 *
 * HOW THE PROOF TRAVELS. `middleware.ts` checks HTTP Basic on `/final` and sets a cookie there.
 * A cookie rather than the Authorization header, because the browser will NOT send Basic
 * credentials to `/api/chat`: the protection space covers paths at or below the authenticated
 * URI, and `/api/chat` is a sibling of `/final`, not a child. Relying on the header would have
 * failed in exactly one place — the request that spends the money.
 *
 * WHAT THE COOKIE IS. A SHA-256 digest of the configured password under a fixed, versioned
 * label. Not a session: there is no state to keep, nothing to expire and nothing to invalidate
 * on restart, and it is exactly as strong as the shared password it stands for — which is the
 * honest ceiling for a demo gate. It is `httpOnly`, so page scripts cannot read it, and the
 * digest is not reversible, so a stolen cookie does not hand over the password itself. Rotating
 * `FINAL_DEMO_PASSWORD` invalidates every outstanding cookie for free, because the digest of the
 * old password stops matching.
 *
 * This is NOT authentication, and nothing here should be mistaken for it. It decides which
 * engine answers, and it decides nothing about who may read what: SEC-01 and SEC-02 are
 * untouched. Web Crypto rather than `node:crypto` because `middleware.ts` runs on the edge
 * runtime, where `node:crypto` is absent and both files must agree on the same digest.
 */

/** Cookie name. Prefixed so it is obvious in devtools which surface set it. */
export const GATE_COOKIE = "novamart_reviewer";

/**
 * Label folded into the digest. Versioned so that if the scheme ever changes, old cookies stop
 * matching instead of being accepted under new rules.
 */
const GATE_LABEL = "novamart-reviewer-gate-v1:";

/** The configured reviewer password, or `undefined` when the gate is not configured at all. */
export function gatePassword(): string | undefined {
  const raw = process.env.FINAL_DEMO_PASSWORD?.trim();
  return raw === undefined || raw.length === 0 ? undefined : raw;
}

/** Digest a password into the value the cookie carries. */
export async function gateToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${GATE_LABEL}${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Length-independent comparison. Both inputs here are hex digests of fixed length, so a timing
 * signal is not a realistic attack; it is written this way so the pattern that gets copied into
 * somewhere it does matter is the safe one.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/**
 * Read one cookie without a parser dependency.
 *
 * Splits on the FIRST `=` only: a cookie value may legally contain `=` (base64 and hex-with-
 * padding both do), and splitting on every one would silently truncate it into a value that
 * never matches.
 */
export function readCookie(header: string | null, name: string): string | undefined {
  if (header === null || header.length === 0) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

/**
 * Did this request come through the reviewer gate?
 *
 * FAILS CLOSED in both directions that matter: no configured password means no request can ever
 * be privileged, and a missing or wrong cookie means the caller gets the public engine. Neither
 * case is an error — the public path is the normal path.
 */
export async function requestPassedGate(request: Request): Promise<boolean> {
  const password = gatePassword();
  if (password === undefined) return false;

  const presented = readCookie(request.headers.get("cookie"), GATE_COOKIE);
  if (presented === undefined) return false;

  return constantTimeEqual(presented, await gateToken(password));
}
