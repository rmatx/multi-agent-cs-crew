/**
 * Runtime-derived fields for the escalation package — AC-TRIAGE-03, AC-TICKET-01, AC-ESC-05.
 *
 * THIS MODULE HAS NO IMPORTS, ON PURPOSE — same reasoning as `toolRegistry.ts`,
 * `moneyIntent.ts`, `needsInput.ts` and `groundingGuard.ts`.
 *
 * WHY THE RUNTIME AND NOT THE MODEL. `create_ticket_stub` has accepted `device` and
 * `app_version` since Sprint 1 and **nothing ever populated them**, because no prompt asked
 * any agent to capture them (qa.md, 2026-08-29: AC-TRIAGE-03, AC-TICKET-01 and AC-ESC-05 all
 * failing for one reason). The fix could have been another prompt line. It is not, for the
 * reason this project keeps relearning: a rule that lives only in prompt text is a request.
 *
 * These are observations, not judgements — the customer said "Android 3.2.0" in words the
 * runtime already has — so they belong with `conversationId`, `tools_tried` and `citations`,
 * which `tools.ts` supplies from what it watched happen and instructs the model never to write.
 * An engineer picking up an app-crash ticket needs the version first, and "the model usually
 * remembers to include it" is not a property worth shipping.
 */

/** Devices the fixture and the corpus actually talk about. Order matters: longest first. */
const DEVICE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bandroid\b/i, "android"],
  [/\b(?:iphone|ipad|ios)\b/i, "ios"],
  [/\b(?:web|browser|desktop|laptop)\b/i, "web"],
];

/**
 * A version like `3.2.0`, or `v3.2` / `version 3.2` when only two parts are given.
 *
 * Two-part numbers are accepted ONLY behind an explicit `v` / `version`, because a bare `3.2`
 * in support prose is far more often a quantity than a release — and a total like `$175.05` or
 * a window like "3 to 5 days" must never be filed as an app version. Three-part numbers are
 * unambiguous enough to take on their own.
 */
const THREE_PART = /(?:^|[^\w.$])(\d{1,3}\.\d{1,3}\.\d{1,4})(?![\w.])/;
const TWO_PART_LABELLED = /\b(?:v|version|build|release)\s*\.?\s*(\d{1,3}\.\d{1,3})(?![\w.])/i;

export type AppContext = {
  device?: string;
  app_version?: string;
};

/**
 * Pull device and app version out of what the customer actually wrote.
 *
 * Returns only what is present: a field absent from the message stays absent from the ticket,
 * because a guessed device is worse than a missing one — it sends an engineer to the wrong
 * platform with confidence.
 */
export function extractAppContext(message: string): AppContext {
  const context: AppContext = {};

  for (const [pattern, device] of DEVICE_PATTERNS) {
    if (pattern.test(message)) {
      context.device = device;
      break;
    }
  }

  const three = THREE_PART.exec(message);
  const two = TWO_PART_LABELLED.exec(message);
  const version = three?.[1] ?? two?.[1];
  if (version !== undefined) context.app_version = version;

  return context;
}

/**
 * The normative intent → category map (PRD AC-ESC-05, ADR-13).
 *
 * Enforced in code rather than asked of the model for the same reason as above: it is a
 * lookup table the PRD wrote out in full, and a lookup table has no business being a
 * probability. `app_issue → other` is the ADR-13 case, and the one most likely to be got
 * wrong by a model reasoning from the words — "app issue" sounds specific, and the category
 * deliberately is not.
 */
const INTENT_CATEGORY: Readonly<Record<string, string>> = {
  order_status: "delivery_issue",
  shipping_policy: "delivery_issue",
  payment_question: "payment_issue",
  returns_policy: "product_quality",
  plus_membership: "membership_issue",
  account_question: "account_issue",
  app_issue: "other",
  human_request: "other",
  other: "other",
};

/**
 * Category for an intent. An unrecognised intent falls back to a model-supplied category when
 * there is one, and to `other` when there is not — the map is normative for the intents the
 * PRD names, not a reason to lose information about an intent it does not.
 */
export function categoryForIntent(intent: string, supplied?: string): string {
  const mapped = INTENT_CATEGORY[intent.trim().toLowerCase()];
  if (mapped !== undefined) return mapped;
  return supplied !== undefined && supplied.trim().length > 0 ? supplied : "other";
}
