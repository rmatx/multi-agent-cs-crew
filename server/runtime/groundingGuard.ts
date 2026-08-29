/**
 * The unaided-answer guard (PRD NFR-SAFE-01 "escalate over invent", AC-FAQ-03).
 *
 * THIS MODULE HAS NO IMPORTS, ON PURPOSE — same reasoning as `toolRegistry.ts`,
 * `moneyIntent.ts` and `needsInput.ts`: it decides whether a turn is allowed to end without
 * evidence, so it must be unit-testable under `node --test` type stripping.
 *
 * WHY IT EXISTS. The coordinator's prompt forbids answering anything from its own knowledge —
 * every content question goes to a specialist. Asked "What is the capital of France?" it
 * mostly obeys and lets faq-policy report the question is not covered. Sometimes it answers
 * "Paris" instead, and once it declined politely without delegating at all and reported the
 * turn `resolved`. At low effort that behaviour is a coin flip, and a coin flip is not a
 * guarantee. The same lesson the tool allowlists already encode: a rule that lives only in
 * prompt text is a request, not a control.
 *
 * So the runtime checks the OUTCOME instead of trusting the instruction. A turn that reached
 * no specialist, opened no ticket, and asked the customer nothing has answered from model
 * memory by definition — whatever it said. That turn is escalated as `ungrounded`.
 *
 * The one legitimate exception is conversational: "hi", "thanks", "that's all". Those need no
 * evidence because they assert nothing. The list below is short and the default is strict —
 * an unrecognised message REQUIRES a specialist, so a new phrasing costs a needless
 * escalation rather than an ungrounded answer. That asymmetry is deliberate.
 */

/** Stripped before matching so "Hi!" and "hi" are the same message. */
function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure pleasantries. Matched against the WHOLE message, never as a substring: "hi, where is
 * my order" is an order question that happens to open politely, and treating it as a greeting
 * would exempt exactly the turns this guard exists to catch.
 */
const PLEASANTRIES = [
  "hi", "hi there", "hello", "hello there", "hey", "hey there", "yo",
  "good morning", "good afternoon", "good evening",
  "thanks", "thank you", "thanks a lot", "thank you so much", "thanks so much",
  "cheers", "ta", "much appreciated", "appreciate it", "perfect thanks", "great thanks",
  "ok", "okay", "ok thanks", "okay thanks", "got it", "understood", "sounds good",
  "bye", "goodbye", "bye bye", "see you", "that s all", "that is all", "no thanks",
  "nothing else", "no that s all", "all good",
];

const PLEASANTRY_SET = new Set(PLEASANTRIES);

/**
 * Does this message need a specialist before the assistant may reply with content?
 *
 * True for anything that is not a bare pleasantry — including the empty case, because a turn
 * with nothing to answer should not be reporting a confident resolution either.
 */
export function requiresSpecialist(message: string): boolean {
  const normalized = normalize(message);
  if (normalized.length === 0) return true;
  return !PLEASANTRY_SET.has(normalized);
}

export type TurnEvidence = {
  /** Agent transfers this turn. Zero means no specialist was consulted. */
  readonly hops: number;
  /** A ticket was opened, so a human has it. */
  readonly escalated: boolean;
  /** The coordinator declared a clarifying question with the control marker. */
  readonly needsInput: boolean;
};

/**
 * Did this turn answer without evidence? True ⇒ the runtime must force an `ungrounded`
 * escalation rather than let the reply stand as a resolved answer.
 */
export function isUnaidedAnswer(message: string, evidence: TurnEvidence): boolean {
  if (evidence.hops > 0) return false;
  if (evidence.escalated) return false;
  if (evidence.needsInput) return false;
  return requiresSpecialist(message);
}
