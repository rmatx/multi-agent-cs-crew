/**
 * Money vocabulary in a CUSTOMER MESSAGE (ADR-16, SAD §6 amended 2026-08-27).
 *
 * Distinct from `isMoneyToolName` in `toolRegistry.ts`, which screens tool identifiers — the
 * words a person uses are not the words a registry uses. This is the deterministic engine's
 * entire intent classifier: it decides only "is this a money request", because that is the one
 * routing decision ADR-16 obliges every engine to make.
 *
 * THIS MODULE HAS NO IMPORTS, ON PURPOSE — same reasoning as `toolRegistry.ts` and
 * `holidays.ts`. Its unit test runs under `node --test` type stripping, which does not resolve
 * the `@/` path alias, so a policy list worth testing has to be reachable without one.
 */

/**
 * Matched on INTENT, not on any occurrence of the word.
 *
 * `cancel` is a request; `cancelled` is a status a customer may simply be asking about, and
 * routing "why was my order cancelled?" to a human would escalate a question the engine can
 * already answer from the order row. The lookahead keeps that distinction.
 *
 * Deliberately SHORT. A keyword matcher that tried to infer `low_confidence` or `ungrounded`
 * would be guessing, and not guessing is the whole reason the deterministic engine exists. It
 * covers money only; every other intent falls through to the grounded reply.
 */
const MONEY_INTENT = new RegExp(
  [
    String.raw`\brefunds?\b`,
    String.raw`\bmoney back\b`,
    String.raw`\bchargebacks?\b`,
    String.raw`\breimburse`,
    String.raw`\bdispute`,
    // `cancel`, `cancels`, `cancelling` — but not `cancelled` / `canceled`.
    String.raw`\bcancel(?!l?ed\b)`,
    String.raw`\bcharge(d|s)?\b`,
    String.raw`\bpayments?\b`,
    String.raw`\bbill(ing|ed)?\b`,
    String.raw`\binvoiced?\b`,
  ].join("|"),
  "i",
);

/** True when the customer is asking about money movement and a human must take over. */
export function isMoneyRequest(message: string): boolean {
  return MONEY_INTENT.test(message);
}
