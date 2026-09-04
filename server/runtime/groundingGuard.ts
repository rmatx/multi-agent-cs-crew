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

/**
 * Stripped before matching so "Thanks!" and "thanks" are the same message. Apostrophes are
 * removed rather than split on, so "that's" normalises to one token and not two.
 */
function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The vocabulary a pure sign-off is made of.
 *
 * DEF-08 (qa.md, 2026-08-29): this used to be a set of whole PHRASES matched against the whole
 * message, and real sign-offs are compounds — "ok thanks, bye" is two pleasantries and matched
 * neither, so **four of eight** sampled closings opened a support ticket. A customer who wrote
 * "Thanks, that is all" was told a human would follow up on a conversation that had already
 * ended happily.
 *
 * The old rule was right about one thing and wrong about another. Right: "hi, where is my
 * order" must never be exempt, because a greeting is not a licence for what follows. Wrong: it
 * treated an unrecognised phrasing as cheap. An escalation is a ticket, a human's attention,
 * and a promise — the same over-escalation cost DEF-03 measured from the other direction.
 *
 * So the unit of matching moves from the phrase to the WORD: a message is conversational when
 * EVERY word in it appears here. "where", "order", "refund", "when", "cancel" and every other
 * content word is absent, so anything with something to answer still requires a specialist.
 * The default stays strict — an unknown word means a specialist — but "unknown word" now means
 * an actual content word rather than an unlisted way of saying goodbye.
 */
const PLEASANTRY_WORDS = new Set([
  // greetings
  "hi", "hii", "hello", "hey", "yo", "there", "good", "morning", "afternoon", "evening",
  "greetings",
  // thanks
  "thanks", "thank", "thankyou", "you", "ty", "cheers", "ta", "much", "appreciated",
  "appreciate", "it", "lots",
  // acknowledgement
  "ok", "okay", "k", "kk", "got", "understood", "sounds", "great", "perfect", "awesome",
  "brilliant", "lovely", "nice", "cool", "fine", "alright", "right", "yes", "yep", "yeah",
  "yup", "sure", "noted",
  // closing
  "bye", "goodbye", "byebye", "later", "see", "soon", "night", "thats", "that", "is", "was",
  "all", "no", "nope", "nothing", "else", "done", "im", "am", "we", "re",
  // connectives and politeness that carry nothing to answer
  "and", "so", "then", "just", "very", "really", "please", "sorry", "for", "your", "help",
  "my", "friend", "a", "the", "to", "me",
]);

/** A message longer than this is not a sign-off, whatever words it is built from. */
const MAX_PLEASANTRY_WORDS = 10;

/**
 * Does this message need a specialist before the assistant may reply with content?
 *
 * True for anything that is not a pure pleasantry — including the empty case, because a turn
 * with nothing to answer should not report a confident resolution either.
 *
 * A question mark forces a specialist regardless of vocabulary: "Is that all?" is built
 * entirely from harmless words and is still a question, and being wrong in that direction
 * costs one needless escalation rather than an ungrounded answer.
 */
export function requiresSpecialist(message: string): boolean {
  const normalized = normalize(message);
  if (normalized.length === 0) return true;
  if (message.includes("?")) return true;

  const words = normalized.split(" ");
  if (words.length > MAX_PLEASANTRY_WORDS) return true;
  return !words.every((word) => PLEASANTRY_WORDS.has(word));
}

export type TurnEvidence = {
  /** Agent transfers this turn. Zero means no specialist was consulted. */
  readonly hops: number;
  /** A ticket was opened, so a human has it. */
  readonly escalated: boolean;
  /** The coordinator declared a clarifying question with the control marker. */
  readonly needsInput: boolean;
  /**
   * DEF-13. A ticket is already open on THIS conversation, so a reply that restates it is
   * grounded — in the session store rather than in a tool call.
   *
   * Observed in the operator's own demo capture: asked for a human twice, the coordinator
   * answered correctly the second time ("there's no need to open a separate request — that
   * ticket has you covered") and this guard escalated it as `ungrounded` anyway, opening a
   * SECOND ticket in the same reply that said none was needed. The turn read `0 hops, 0 tool
   * calls`, which is exactly what the guard keys on, and exactly what a correct answer from
   * conversation state also looks like.
   *
   * Evidence is not only a tool result. What the runtime already knows about this conversation
   * counts, and the runtime can check it rather than guess: `listTicketStubsForConversation`
   * has held the answer the whole time.
   */
  readonly hasOpenTicket: boolean;
};

/**
 * Did this turn answer without evidence? True ⇒ the runtime must force an `ungrounded`
 * escalation rather than let the reply stand as a resolved answer.
 */
export function isUnaidedAnswer(message: string, evidence: TurnEvidence): boolean {
  if (evidence.hops > 0) return false;
  if (evidence.escalated) return false;
  if (evidence.needsInput) return false;
  // DEF-13. Grounded in the conversation, which is still grounded.
  if (evidence.hasOpenTicket) return false;
  return requiresSpecialist(message);
}
