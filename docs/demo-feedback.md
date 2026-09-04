# Demo feedback log — 2026-09-04

Raised by the operator while running the live demo. **Nothing here was fixed during the demo**,
deliberately: changing agent prompts or client validation mid-session is how a working demo stops
working. Each item is recorded with enough evidence to act on cold.

To pick these up: say **"demo recorded"** — see the `post-demo-next-steps` memory. `@qa.eng`
should fold the defects into `qa.md`'s register and the enhancement into `frontend.md` when
these are actioned.

---

## DEF-12 — The UI demands an order number for questions that do not need one

**Severity: medium. Open.** Found by the operator asking *"What Plus plan am I on?"* with
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

**Enhancement. Open.** On an escalation the customer currently sees:

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
