# Demo feedback log — 2026-09-04

> **All four items below were FIXED on 2026-09-04** and verified in the browser against the
> real crew. Kept as a record of what was found and why it was missed, not as an open list.

Raised by the operator while running the live demo. **Nothing here was fixed during the demo**,
deliberately: changing agent prompts or client validation mid-session is how a working demo stops
working. Each item is recorded with enough evidence to act on cold.

To pick these up: say **"demo recorded"** — see the `post-demo-next-steps` memory. `@qa.eng`
should fold the defects into `qa.md`'s register and the enhancement into `frontend.md` when
these are actioned.

---

## DEF-12 — The UI demands an order number for questions that do not need one

**Severity: medium. FIXED 2026-09-04.** Found by the operator asking *"What Plus plan am I on?"* with
customer id 38 and being told to add an order number.

**Root cause is client-side only.** `lib/chatClient.ts` → `buildChatRequest()`:

```ts
const orderId = input.orderId.trim();
if (orderId.length === 0) {
  return { ok: false, reason: "Add your order number so we can look it up." };
}
```

The turn is rejected in the browser and never reaches the server. **The server is fine** —
`ChatRequest.identity` has both `userId` and `orderId` optional
(`packages/shared/src/dto.ts:14`), and membership and order-history turns driven directly
against `/api/chat` with only a `userId` work correctly. This is a validation rule that is
stricter than the contract it claims to mirror; its own comment says "Mirrors the server 400
rules", and it does not.

**Blast radius — 6 of the 23 demo scenarios cannot be run through the UI at all:**

| Scenario | Identity |
|---|---|
| Recent orders, no order id | user 9970 |
| Trial with days left | user 45344 |
| Which plan am I on | user 38 |
| Annual plan | user 91 |
| Expired membership | user 28 |
| Restricted action | user 38 |

That includes the whole membership story and the `list_orders_for_user` path — the one tool
whose entire purpose is answering without an order id.

**Why no test caught it.** Every layer tested the wrong side of the boundary: `eval:sdk` and
`evals/run.mjs` both POST to `/api/chat` directly and bypass the client, and browser
verification only ever drove order-id scenarios. `lib/chatClient.test.ts` asserts the current
behaviour is correct, so it passes. This is the third time in this project a green suite has sat
on top of a real defect (DEF-09, DEF-11, now this) — each time because the fixture happened to
avoid the broken case.

**Recommended fix** (`@frontend.eng`): require *an* identity, not specifically an order number —
accept an order id **or** a customer id, and only demand an order id when the message needs one.
The field label ("Order number (required)") needs to change with it. Add a
`lib/chatClient.test.ts` case for userId-only, and an eval item that drives the UI rather than
the API.

---

## ENH-01 — Show the handoff email in the answer

**Enhancement. BUILT 2026-09-04.** On an escalation the customer currently sees:

> Handed to a human. Ticket STUB-46C0DE6B — a change this assistant cannot make.

**Request:** show the text of the simulated handoff email in a **collapsible box** beneath that,
so the audience can see what a human actually receives without leaving the app.

The content already exists and needs no new generation — `writeHandoffArtifacts()` composes the
same entry it appends to `data/outbox.md`, and the full packet is at
`data/tickets/<STUB-ID>.md`.

**Design notes for whoever builds it:**

- **Collapsed by default.** It is operator/demo context, not something a real customer needs
  pushed at them mid-conversation.
- **Serve it, do not re-render it.** The box should show the *same text that was written*, so
  the screen and the artifact cannot disagree. Cheapest route is a small read endpoint keyed on
  the ticket id, reusing the existing operator-key gate.
- **It is customer content** — SEC-03 applies. It is already PII-scrubbed at write, so serving
  the stored text inherits that; generating a fresh copy in the client would not.
- Consider gating it behind demo/trace mode rather than showing it to every customer.

---

## Notes

- Both items were raised during a live demo run and confirmed by reading the code, not by
  re-running the app — the demo server was left untouched.

---

## ENH-02 — Crew status bar: show every agent, light the one answering

**Enhancement. BUILT 2026-09-04.** Requested during the demo.

The banner currently says only what the *turn* is doing:

> Crew: handed off — A person has this now.

**Request:** an LED-style strip along the top showing **all six agents**, with the one handling
the current turn highlighted — so an audience can see who picked the question up, and that a
crew exists at all rather than one model in a trench coat.

## ENH-03 — Name the answering agent next to `ASSISTANT`

**Enhancement. BUILT 2026-09-04.** Same idea at message level: the transcript label reads `ASSISTANT`, and it
should read `ASSISTANT · returns-advisor` (or similar) so a scrolled-back transcript still shows
which specialist produced each answer.

### One design decision both of these need first

**Agent identity is currently operator-only, by construction.** `server/runtime/engines/sdk.ts`
gates every `agent_hop` and `tool_call` frame behind a single check:

```ts
// Trace frames are operator-only: gated here, once, rather than at each call site.
const emitTrace = (event: StreamEvent): void => {
  if (input.trace) emit(event);
};
```

So with trace off the client **never learns which agent answered** — the information does not
reach the browser at all. That is deliberate: `AC-CHAT-03` requires no raw tool JSON in customer
text, and the trace panel is explicitly an operator surface behind `OPERATOR_KEY`.

Three routes, in increasing cost:

1. **Demo/trace-gated only (cheapest, recommended first).** Both features render when
   `?trace=1` or demo mode is on, using the `agent_hop` frames that already arrive. Zero
   contract change, zero customer-facing risk, and it covers the demo — which is what prompted
   the request.
2. **Ungate `agent_hop` for all turns.** Makes agent identity customer-visible. That is a
   product decision, not a styling one: does a customer benefit from reading
   `escalation-handoff`? If yes, the ids need customer-facing display names ("Returns
   specialist", not `returns-advisor`).
3. **A new non-trace frame carrying a friendly agent label.** Cleanest for customers, but it
   touches `packages/shared/src/dto.ts`, which is under the SAD's contract freeze — that is an
   `@integration.eng` conversation, not a frontend change.

**Recommendation:** build route 1 for the demo. Route 2 or 3 only if agent identity is decided
to be customer-facing, which is a PRD question.

**Also worth noting for ENH-02:** the deterministic engine emits no `agent_hop` frames at all, so
a crew strip would sit empty during a free rehearsal. It should show an honest "keyless engine —
no crew running" state rather than a row of dead LEDs, or the rehearsal will look broken.

---

## Resolution — 2026-09-04

**DEF-12.** `buildChatRequest` now requires *an* identity rather than an order number
specifically. `lib/chatClient.test.ts` did not exist before this; it does now, with 8 cases
including the exact failing input (customer 38, no order). Field labels dropped
"(required)"/"(optional)" — neither is individually required.

**ENH-01.** `GET /api/tickets/<id>/email` serves the STORED packet from `data/tickets/`, never a
re-rendering, so the screen and the artifact cannot disagree and the response inherits the
write-time PII scrub. Gated on a **server-side** `DEMO_MODE=1` set by `scripts/demo.sh` —
deliberately not the `NEXT_PUBLIC_` flag, which ships in the browser bundle and is not a control.
Verified: 404 with the gate off, 404 on a traversal attempt.

**ENH-02 / ENH-03.** Route 1 as recommended — both render from the `agent_hop` frames the FSM
already collected, so no frame, DTO or contract changed. Demo mode now switches the trace on,
because agent identity only reaches the browser on trace frames and the features would otherwise
be empty in the mode built to show them. The crew strip shows an honest "keyless engine — no crew
running" note on the deterministic engine rather than six dead LEDs.

**One bug found while verifying.** The first cut labelled only *transcript* entries, which are
written on the following turn — so the answer actually on screen, the one an audience looks at,
was the only one without an agent name. The live message carries the tag too now.

---

## DEF-13 — A correct coordinator answer is force-escalated as `ungrounded`

**Severity: medium. Open.** Found in the operator's own demo capture
(`week5/assets/demo-capture.pdf`, page 2), which is why it matters: it is visible in a document
going to a reviewer.

**Observed.** The customer asked for a human twice. The second time:

> I've already opened ticket STUB-4645DFE7 … **There's no need to open a separate request** —
> that ticket has you covered.
>
> **Ticket STUB-AB902A64 is open with our support team.** … Reason: **ungrounded**. A human will
> pick this up — I can't process refunds, cancellations, or payments myself.

Three things wrong in one reply: it says no separate ticket is needed and then opens one; the
reason code is `ungrounded` when the customer requested a human
(`customer_requested_human` exists for exactly this); and the closing line is refund boilerplate
on an escalation with nothing to do with money.

**Root cause.** ADR-17's unaided-answer guard. `sdk.ts` forces an escalation when
`isUnaidedAnswer(...)` is true, and the coordinator had answered **correctly from conversation
memory** — the operator trace on that turn reads `0 hops · 0 tool calls`. The guard cannot
distinguish "answered with no evidence" from "answered from what this conversation already
established", so a good answer is punished as a hallucination.

The guard's asymmetry is deliberate and documented — it prefers a needless escalation to an
ungrounded answer. DEF-08 was the same trade misfiring on pleasantries. This is the third time
that preference has produced a wrong-feeling turn, which suggests the guard needs a notion of
"grounded in the conversation" rather than only "grounded in a tool call".

**Independently corroborated.** Arize's demo report flagged the same closing line without seeing
this trace: *"Escalation wording is overly payment-specific — the handoff response uses
boilerplate about refunds, cancellations, or billing even when the escalation was triggered by
another issue type."*

**Recommended fix** (`@backend.eng` + `@system.arch`, since it touches ADR-17):

1. Treat a reply that restates a ticket already open on this conversation as grounded — the
   session store holds that ticket, so the runtime can check rather than guess.
2. When an escalation is forced, carry the *customer's* intent into the reason code instead of
   defaulting to `ungrounded`.
3. Make the closing sentence reason-aware rather than always naming refunds (Arize finding 3).

**Note on the duplicate ticket.** `createTicketStub` is idempotent per
`(conversation_id, reason_code)`, so the second ticket was created only because its reason code
differed — `ungrounded` vs `customer_requested_human`. Fixing 2 above closes this as a side
effect.
