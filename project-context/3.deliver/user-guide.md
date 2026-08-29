# NovaMart Support Crew — Installation Guide and User Manual

Persona: `@devops.eng` · Action: `*document-user-guide` · Template: `.cursor/templates/user-guide-template.md`

---

## 1. Product overview

NovaMart Support Crew is a customer-support chat application. You type a question about a
NovaMart order, membership, return or app problem, and a team of specialised agents answers it
from NovaMart's own data and written policy — an order lookup, a policy search, a membership
check — or hands the conversation to a human with a ticket that carries the context.

It is built for two audiences at once. A **customer** sees one assistant and one conversation.
An **operator** can switch on a trace and see which agent handled the turn, which tools it
called, what it cited, and what the turn cost.

**The one thing to know before using it: this assistant cannot move money.** No refund,
cancellation, payment or billing function exists anywhere in the software. That is not a policy
it has been asked to follow — it is a capability that was never built, verified by an automated
check that fails the build if such a function ever appears. Ask for a refund and it will open a
ticket for a person, every time, on both engines.

### MVP limitations, stated plainly

- **No authentication.** Anyone who can reach the app can look up any order by its number. It
  is intended to run on one machine, reachable only from that machine.
- **No tracking numbers.** NovaMart's support data has no carrier or parcel information. The
  assistant will tell you an order's status and dates, and say plainly that tracking is not
  available here rather than inventing it.
- **The catalogue data is fictional** and frozen in 2024–25. Dates you see are shifted onto
  today's calendar so windows and trials behave sensibly (see §5).
- **Conversations are not private between people.** Anyone holding a conversation's id can
  continue it and read its history.
- **One known defect** (INT-03): on the model-backed engine, an unknown order number produces a
  correct, honest reply, but the turn is reported as finished rather than as waiting for you.
  The text is right; the status badge is optimistic.

---

## 2. Prerequisites

| Requirement | Detail |
|---|---|
| Node.js | **24** (pinned in `.nvmrc`). Node ≥ 22.5 is a hard floor — the app uses the built-in SQLite driver |
| npm | Ships with Node |
| OS | macOS or Linux. Windows via WSL2 |
| Browser | Any current Chrome, Safari, Firefox or Edge |
| Docker *(optional)* | Engine + Compose v2.24+, only if you prefer the container |
| API key *(optional)* | `ANTHROPIC_API_KEY` — **only** for the model-backed crew. The default engine needs no key and costs nothing |

Environment variables are documented by **name** in `.env.example`. Never commit values.

---

## 3. Installation

### From a clone

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. No database to create, no migration to run: the app falls back
to the committed 3.2 MB catalogue fixture, and it creates its own SQLite files on first use.

### With Docker

```bash
docker compose up --build
```

Same address. State lives in a named volume and survives restarts.

### Health check

```bash
curl -s localhost:3000/api/health
```

A healthy instance returns `status: "ok"` with `duckdb: "ok"` and `stores: "ok"`. It also
reports which `engine` is live — worth checking before a demo, because the two engines make
different claims (§5).

### Optional configuration

Copy `.env.example` to `.env.local` and fill in only what you need:

- `ANTHROPIC_API_KEY` + `MODEL_ID` + `CHAT_ENGINE=sdk` — run the actual crew
- `AS_OF_DATE=2026-09-01` — pin the demo clock so dates are reproducible
- `OPERATOR_KEY` — enable the operator trace endpoint. **Unset means that endpoint is off**

---

## 4. Getting started

1. Enter an **order number** in the identity bar. `46101` is a good first one.
2. Ask **"Where is my order?"** and press **Run** (or Enter).
3. The answer streams in. Under it, **Sources** lists exactly what the answer came from —
   `duckdb:orders:46101` means an order row, `policy:returns#return-window` means a section of
   the written returns policy.

Then try a follow-up **without re-entering anything**: *"Can I still return it?"* The
conversation remembers which order you meant, and the assistant re-reads the order rather than
recalling what it said before.

### A tour of what the crew can do

| Ask | What you should see |
|---|---|
| Where is my order? | Status, date and total, and an honest note that tracking is not available |
| What have I ordered recently? *(customer id `9970`)* | The five most recent orders, newest first |
| How long is the Plus free trial? | 14 days, with a policy citation |
| Is my Plus trial still active? *(customer id `45344`)* | An active trial with days remaining |
| Can I still return this order? *(order `46101` / `1`)* | Inside the 14-day window / 365 days ago and outside it |
| I sent this back — how long until it's processed? *(order `45662`)* | 3–5 business days, plus real public holidays for that customer's country |
| Please cancel my Plus membership | A ticket, and a clear statement that it has **not** been cancelled |
| I want a refund | A ticket with the reason `money movement` |
| What is the capital of France? | A refusal and a ticket — it will not answer from general knowledge |

That last row is worth doing deliberately. It is the clearest demonstration of what the system
is: it would rather hand you to a person than answer something it cannot ground in NovaMart's
data or policy.

---

## 5. Everyday use

### Reading the status banner

The banner names the outcome, and the words are chosen to mean different things:

| Banner | Meaning |
|---|---|
| **running** | A turn is in flight. With Trace on, it names the agent and the tool |
| **done** | Answered from NovaMart data |
| **needs input** | Waiting on **you** — usually a missing order number |
| **handed off** | A **person** has this now. A ticket id is shown; quote it if you follow up |
| **error** | The turn did not complete. **Retry** replays the same question |

### Talk to a human, any time

The **Talk to a human** button is always available. You do not have to phrase a request well
enough for a classifier — press it and the conversation is handed over with a ticket.

### The operator trace

Add `?trace=1` to the URL, or tick **Trace**. The panel at the bottom shows the hop path, each
tool call, the citations, and the turn's clock settings.

With Trace **off**, the panel is empty — not filtered. The server does not send those frames to
a customer at all, so there is nothing for the page to hide. That is deliberate: the customer
sees one assistant, not a crew.

### Two engines, two different claims

`/api/health` reports which is running, so a walkthrough never has to be taken on trust.

| Engine | What runs | Needs a key |
|---|---|---|
| `deterministic` *(default)* | An order lookup with the reply composed in code. No model call | No |
| `sdk` | The six-agent crew: triage routing to order, policy, Plus, returns and escalation specialists | Yes |

The deterministic engine exists so the demo and CI stay keyless and reproducible. **It is not
the product** — the capstone claim is the crew. Both engines route a refund request to a human;
only the crew can answer a policy question.

### Why the dates look current

The catalogue is frozen in 2024–25. Every date is shifted onto today's calendar inside the data
layer, so a 14-day return window and an active membership behave the way they would in a live
system. Pin `AS_OF_DATE` to make a walkthrough reproducible; leave it unset and "today" moves
with the clock.

---

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Order number (required)` won't accept my question | The chat needs an order id for order questions. Policy questions ("how long is the trial?") need no id |
| "Too many messages. Please wait a moment." | The rate limit (20 turns/minute by default). Wait, or raise `RATE_LIMIT_PER_MIN` |
| Health shows `engine: deterministic` when you wanted the crew | `CHAT_ENGINE=sdk` was not set, or the process was started before you set it. Restart it |
| Health shows `sdkEngineConfigured: false` | `ANTHROPIC_API_KEY` or `MODEL_ID` is missing from `.env.local` |
| The crew answers, but says a policy question is "not covered" | The corpus genuinely lacks it. Add a `##` section to the right file in `data/policy/` and restart |
| A policy file edit changes nothing | Only in production builds — the corpus caches per process there. Restart. In `npm run dev` it re-reads every call |
| `503` from `/api/conversations/:id/trace` | `OPERATOR_KEY` is unset, so the endpoint is switched off. This is the intended default |
| `401` from the same endpoint | Wrong or missing `X-Operator-Key` header |
| Health returns 503 with `stores: "error"` | The data volume is unwritable. Check the mount and its ownership |
| A ticket disappeared after a restart | It should not — tickets are durable. If it did, the volume was removed (`docker compose down -v`) |

### Where to find logs

- **Per-turn operator records:** `project-context/2.build/logs/<conversationId>.jsonl` — the
  agents, the tools, the cost, and the prompts. **These contain the conversation text**, so
  treat the directory as customer data.
- **Server output:** the terminal running `npm run dev`, or `docker compose logs -f`.
- **Whole-conversation view:** `GET /api/conversations/:id/trace` with the operator key —
  transcript, tickets, CSAT and the hop path in one response.

---

## 7. Deployment notes (operators)

Full runbook: [`project-context/3.deliver/deploy.md`](deploy.md). The essentials:

- **Run it on one machine, reachable only from that machine.** The compose file publishes to
  `127.0.0.1` on purpose. There is no authentication: anyone who can reach the port can read
  any customer's order, and anyone holding a conversation id can read that conversation. If you
  are considering sharing a URL, read `project-context/2.build/security.md` first.
- **Promotion is manual.** CI verifies; it never deploys.
- **Rollback:** `docker compose down`, check out the previous tag, `docker compose up --build
  -d`. State survives, because the image holds none. Add `-v` to wipe the data volume for a
  clean demo — that destroys every ticket and transcript.
- **Before a demo:** check `/api/health`, pin `AS_OF_DATE`, and on the crew engine run
  `npm run eval:sdk` (expect 102/102) before anyone is watching.

---

## Sources

- `project-context/2.build/setup.md` — local install and environment
- `project-context/2.build/integration.md` — endpoint contracts, envelope, verified behaviour
- `project-context/2.build/backend.md` — agents, tools, engines, known gaps
- `project-context/2.build/frontend.md` — UI surfaces and status vocabulary
- `project-context/2.build/qa.md` — verification results and open defects
- `project-context/2.build/security.md` — SEC-01/SEC-02 and the deployment condition
- `project-context/3.deliver/deploy.md` — runbook this guide points to
- `project-context/1.define/prd.md` — F-CHAT-01, F-ORDER-01, F-PLUS-01, F-RET-01, F-ESC-01,
  F-TRACE-01, F-CSAT-01, F-TIME-01
- `README.md` — the demo id table this guide's tour reuses

## Assumptions

1. Readers are running the app locally or on a single demo host, per `deploy.md`.
2. Order and customer ids used in §4 exist in the **committed** fixture; they were verified
   against it. A different catalogue would need different ids.
3. Screenshots are not embedded here; `docs/screenshots/` holds current ones and the README
   shows them in context.
4. No capability is described that is not implemented — the template forbids it, and the known
   gaps in §1 are stated rather than omitted.

## Open Questions

| ID | Question | Owner |
|---|---|---|
| UG-OQ-1 | Should the guide document the CSAT rating flow in more detail? It is one click and self-explanatory today, and a longer section would outweigh the feature. | `@devops.eng` |
| UG-OQ-2 | `docs/novamart-demo-90s.mp4` and screenshots 01–03 predate the six-agent crew and show the Sprint 1 single-agent build. Re-record before the capstone submission? | Operator |
| UG-OQ-3 | Does the audience need a Windows-native (non-WSL) install path? | Operator |

## Audit

| Field | Value |
| ----- | ----- |
| Persona | `@devops.eng` |
| Action | `*document-user-guide` |
| Timestamp | 2026-08-28 |
| Resolved runtime | `claude-agent-sdk` (env `AAMAD_TARGET_RUNTIME`, matches `aamad.config.yml`) |
| Template | `.cursor/templates/user-guide-template.md` — all seven sections generated |
| Config gate | `aamad.config.yml` → `documentation.require_user_guide: true` — satisfied |
| Verification | Every command and id in §3–§5 was executed against the running app on 2026-08-28; the troubleshooting table is drawn from failures actually observed during Build, not imagined |
| Self-check | Required sections present: Sources, Assumptions, Open Questions, Audit |
