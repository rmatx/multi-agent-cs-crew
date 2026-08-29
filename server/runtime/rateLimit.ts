/**
 * In-memory fixed-window rate limit (SAD §4 error envelope: "429 rate limit (simple
 * in-memory)").
 *
 * WHAT THIS IS FOR, precisely: `POST /api/chat` on the sdk engine spends the operator's
 * Anthropic key on every call and has no authentication (see `integration.md` Assumption 2).
 * A loop against it is a bill, not just load. This caps that.
 *
 * WHAT IT IS NOT: a defence against a distributed or determined caller. It is per-process and
 * keyed on a client address that a proxy can forge. Single-node MVP is exactly the scope the
 * SAD grants it, and `@security.eng` should read it as a cost guard rather than access control.
 *
 * Fixed window over sliding: a sliding window needs per-request timestamps retained per key,
 * and this must not become a memory leak in the process serving the demo. The tradeoff is the
 * usual boundary burst — up to 2× the limit across two adjacent windows — which is acceptable
 * when the limit exists to stop a runaway loop rather than to meter fairly.
 */

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT_PER_MINUTE = 20;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

/** Keys expire with their window, but a long-running process still needs a sweep. */
const MAX_TRACKED_KEYS = 10_000;

export function resolveRateLimit(): number {
  const raw = process.env.RATE_LIMIT_PER_MIN?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_LIMIT_PER_MINUTE;
  const parsed = Number(raw);
  // 0 disables the limit outright — an explicit operator choice, not a fallback.
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LIMIT_PER_MINUTE;
  return Math.trunc(parsed);
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  const limit = resolveRateLimit();
  if (limit === 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY };

  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, bucket] of buckets) {
      if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (bucket === undefined || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count };
}

/**
 * Client key. `x-forwarded-for` is trusted only because the deployment target is a single
 * host behind at most one proxy (SAD §5); it is spoofable, which is the main reason this is
 * documented as a cost guard rather than a control.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return request.headers.get("x-real-ip") ?? "local";
}

/** Test seam. */
export function resetRateLimit(): void {
  buckets.clear();
}
