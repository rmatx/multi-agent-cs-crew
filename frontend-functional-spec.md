# Frontend Functional Spec — NovaMart Support (Sprint 1 slice)

Owner: `@frontend-eng` · Runtime: `claude-agent-sdk` · Scope: MVP P0 only
(F-CHAT-01, F-ORDER-01, F-TIME-01, F-TRACE-01 minimally).

This is the detailed UI contract. `project-context/2.build/frontend.md` points here and does
not duplicate it.

---

## Critical Workflow

**Grounded Order Status (WISMO)**

`orderId` → `POST /api/chat` (SSE) → order lookup against DuckDB with date-shift → streamed
grounded status → `done`.

One turn, one agent path, no LLM call in this slice. The grounded sentence is composed
deterministically from the tool result (see Results), which keeps the slice runnable without
an API key and keeps the F-EVAL-01 WISMO script reproducible.

---

## Inputs

| Input | Required | Source | Validation (client, mirrored by the server) |
| ----- | -------- | ------ | ------------------------------------------- |
| `orderId` | **yes** | Identity bar | non-empty, digits only → `identity.orderId: number` |
| `userId` | no | Identity bar | if present, digits only → `identity.userId: number` |
| message text | **yes** | Composer | non-empty after trim, ≤ 2000 chars |
| `trace` | no | Identity bar checkbox | boolean → `clientFlags.trace` |
| `conversationId` | no | held in client state after the first `session` event | opaque string, echoed back unchanged |

Validation lives in `buildChatRequest()` (`lib/chatClient.ts`) and returns either a typed
`ChatRequest` or a single plain-language reason. It never partially submits.

**When identity is missing.** Two layers, and they must stay consistent:

1. *Client:* Send is blocked and the composer shows
   "Add your order number so we can look it up." No request is issued.
2. *Server:* if a request nonetheless arrives without a valid integer `identity.orderId`, the
   route streams a clarifying question and terminates with `done{status:"needs_input"}`. This
   mirrors SAD §2 `Routing → Clarifying`; the customer is never left without a next step.

The client does **not** treat missing identity as an error state. It is a normal turn outcome.

---

## Run

**Request** — `POST /api/chat`, body is `ChatRequest` (imported from `@shared/dto`, never
restated):

```json
{ "conversationId": "…optional…",
  "message": "where is my order?",
  "identity": { "orderId": 46101, "userId": 7 },
  "clientFlags": { "trace": false } }
```

**Response** — `text/event-stream`. Each frame is `data: <StreamEvent JSON>\n\n`.
`StreamEvent` is the frozen union in `packages/shared/src/dto.ts` (SAD §4). Client behaviour
per variant:

| Event | Client action |
| ----- | ------------- |
| `session` | store `conversationId` for subsequent turns; no visible change |
| `token` | append `text` to the in-flight assistant message (incremental render) |
| `agent_hop` | ignored in this slice (trace-only; no FSM effect) |
| `tool_call` | ignored in this slice (trace-only; no FSM effect) |
| `citation` | store ids; rendered as "Sources: …" under the answer |
| `escalation` | no FSM effect; the following `done{escalated}` is what the UI reacts to |
| `csat_prompt` | ignored — CSAT is out of Sprint 1 |
| `error` | render the plain-language `message`; terminal (see State machine) |
| `done` | terminal; store `status` |

Transport failures (non-2xx, dropped socket, abort) are converted into a synthetic `error`
event before reaching the FSM, so the state machine only ever sees the frozen union — there
is no second failure vocabulary.

**Trace metadata.** `{ asOf, shiftDays, overlayHit }` is required by the Sprint 1 exit
criteria but has no slot in the frozen `StreamEvent` union. It rides on the response headers
`X-Novamart-As-Of`, `X-Novamart-Shift-Days`, `X-Novamart-Overlay-Hit` (plus
`X-Novamart-Conversation-Id`). No UI panel renders it yet — the TracePanel is deferred.

**Streaming expectation (traceability note, ADR-04 / adapter Execution).** The runtime is
streaming, not poll-based. That is why the service surface is `startTurn(req):
AsyncIterable<StreamEvent>` + `getTurnTrace(conversationId)` rather than a generic
`startRun`/`getRunStatus` pair: there is no run status to poll, and the UI must render tokens
as they arrive (TTFT < 5s is a Sprint 1 exit criterion). Any future move to a request/response
model would be a visible UI regression, not an implementation detail.

---

## Results

A **grounded** answer renders exactly the lines the server streamed, in order:

```
Order 46101 is completed.
Placed 2026-08-13 (today). Order total $175.05.
Items:
- StudyTab Tablets Mini 67 x1 — $30.94
- ComfortFit Tops Pro x1 — $138.12
I can't process refunds, cancellations, or payments here.
```

- **Status** — `orders.status` verbatim.
- **Dates** — always the *shifted* date plus a relative phrase computed against `asOf`. Raw
  practice-DB dates (2024–2025) never reach the UI; the shift is applied inside the
  repository adapter (`server/data/dateShift.ts`).
- **Line items** — product name, quantity, line total from `order_items ⋈ products`.
- **Sources** — the `citation` ids (`duckdb:orders:<id>`, `duckdb:order_items:<id>`).

**Non-grounded / not-found path.** If the order id does not resolve, the server streams
"I couldn't find order N. Please double-check the number, or I can hand you to a human." and
ends `done{status:"needs_input"}`. The results area shows "I need a bit more information
before I can answer." No invented status, no guessed date, no partial order.

**On `error`** the plain-language message is shown inline with a **Retry** button, offered
only when the server marked the error `retryable`. Retry replays the *same request object*
that was sent — the page holds `lastRequest` because the composer is cleared on submit, so
re-reading the form would replay whatever the user has since typed. There is no silent
auto-retry and no retry-diff view.

### Crew status (banner, pill, timestamp)

A status banner sits above the chat and is the single at-a-glance readout of crew state.
Every **status** word — the banner label, its hint, and the `Run` / `Running…` button text —
comes from `lib/status.ts`, so those cannot drift apart. `Reset` and `Retry` are control names
rather than statuses and are literals in the component.

| FSM state | Banner | Pill | Hint |
| --- | --- | --- | --- |
| `idle` | Crew: idle | gray | Waiting for an order number and a question. |
| `running` | Crew: running | blue (pulsing) | Looking that up. |
| `done` + `resolved` | Crew: done | green | Answered from order data. |
| `done` + `needs_input` / `escalated` | Crew: needs input | amber | Could not answer with what it has. |
| `done` + `error` | Crew: error | red | The turn did not complete. |

The amber tone is an addition to the agreed gray/blue/green/red vocabulary. A turn that ended
without answering is not a failure, but colouring it green would claim a success that did not
happen, so it gets its own tone rather than being collapsed into either neighbour.

Colour is never the only carrier: the label text states the status too, and the banner is a
`role="status"` live region so a screen reader announces changes.

**Last updated** shows the local time of the most recent state change, next to the label. It
exists so a user can tell the UI is live rather than wedged — with a local DuckDB read
finishing in ~20 ms, `running` can otherwise flash past unseen.

### Controls

**Run** and **Reset** only. Pause, cancel and retry-diff are deferred.

- **Run** — submits the composer. Disabled while a turn is in flight; label reads `Running…`
  during it, matching the banner.
- **Reset** — returns to `idle` and clears the transcript, citations, notices and
  `lastRequest`. Disabled while running and while already idle.
- **Retry** — appears inline with a retryable error only, as described above.
- **Enter** in the composer runs the turn; **Shift+Enter** inserts a newline.

**Grounding rule (binding).** *No fact appears in the UI that did not come from a tool
result.* The client never formats, derives, or defaults an order fact: it renders server text
verbatim and adds only its own static chrome (labels, the no-refunds welcome line, status
prose for `needs_input` / `escalated`). Consequence: there is no client-side "order card"
built from parsed tokens, and there will not be one until the contract carries a structured
facts frame (see Open Questions).

---

## History

Transcript is **in memory only** for this slice: a `Turn[]` array in the page component
(`{ id, role: "you" | "assistant", text }`) plus the in-flight text held by the FSM. Reloading
the tab loses the conversation.

`conversationId` is kept in client state and echoed on subsequent turns so the server can
adopt session durability later without a client change.

SQLite session durability (`data/sessions.sqlite`, ADR-10) is **deferred** — SAD "Sprint 1 —
thin vertical slice" explicitly allows an in-memory session provided the DTO shape is
honored, which it is.

---

## State machine

`lib/fsm.ts`. Three phases; `done` carries the status the server sent.

```
idle ──submit──▶ running ──done{status}──▶ done(resolved | escalated | needs_input)
                    │                            │
                    └──error──▶ done(escalated, error)   └──submit──▶ running
```

Illegal transitions are unrepresentable: `transition(state, action)` is total, `submit` is a
no-op while `running` (double-send guard), stream events are ignored unless `running`, and
only the `done` phase carries a `status`, typed as `TurnStatus = StreamEvent["done"].status`
— so the client status set cannot drift from the wire contract.

| Client state | SAD turn lifecycle (§2) | Notes |
| ------------ | ---------------------- | ----- |
| `idle` | — (no turn in flight) | before first send, or after `reset` |
| `running` | `Routing`, `Clarifying`, `Working`, `Escalating` | all non-terminal server states look identical to the client: tokens may arrive |
| `done{resolved}` | `Answered` | grounded reply delivered |
| `done{escalated}` | `Escalated` | also the landing state for `error` and for `Aborted`, which has no distinct wire status |
| `done{needs_input}` | `Clarifying` (turn ended awaiting the customer) | identity missing or order not found |

**The client FSM is a mirror of the server lifecycle, not a second source of truth.** The
client never decides a turn ended, never picks a terminal status, and never infers escalation
from message content — it only stores what `done` / `error` told it. If the two ever disagree,
the server is right and the client is a bug.

---

## Spec Sync checklist

Run after each commit that touches the frontend:

- [ ] DTO types are still **imported** from `@shared/dto`, not restated anywhere (page, chat
      client, services, mock stream, route handler).
- [ ] FSM states and `TurnStatus` still match the `StreamEvent` union; every variant is still
      handled (or explicitly ignored) in `applyEvent`.
- [ ] Any new UI state or control is reflected in **Inputs**, **Run**, or **Results** above.
- [ ] Everything deferred is still listed as deferred (CSAT, TracePanel UI, policy search,
      plus/returns/faq agents, SQLite sessions, escalation, money tools = never).
- [ ] **Spec-to-impl pass**: every name in this document exists in the code with the same
      spelling (`startTurn`, `lastRequest`, `crewStatus`, `Run` / `Reset` / `Retry`), and any
      TODO already addressed has been deleted rather than left standing.
- [ ] Status wording still comes only from `lib/status.ts` — no status string literal added
      to a component.
- [ ] Spec **Audit** timestamp bumped and a row added to the change log below.

### Change log

Newest first. One row per change that touched the frontend contract.

| Date | Item | Status | What changed |
| --- | --- | --- | --- |
| 2026-08-13 | Crew status banner | Done | Added banner, colour pill, and last-updated timestamp; all wording centralised in `lib/status.ts`. |
| 2026-08-13 | Controls | Done | `Send` became `Run`; added `Reset` and an inline `Retry` for retryable errors. |
| 2026-08-13 | Retry inputs | Done | Page holds `lastRequest` so Retry replays the submitted request, not the current form contents. |
| 2026-08-13 | Contracts | No change | No DTO or payload shape edited — banner state is derived from the existing `StreamEvent` stream. |
| 2026-08-13 | Duplicate React keys | Fixed | `append` captured the id before the state updater; previously both appends in a tick shared a key. |
| 2026-08-13 | README | Done | Added local run steps, the seeded order table, and where the `claude-agent-sdk` runtime connects next. |

---

## Sources

- `project-context/1.define/sad.md` §2 (Turn lifecycle, hop accounting), §3 (Frontend
  Architecture Specification), §4 (API contracts normative, temporal layer, env var names),
  "Contract freeze gate", "Sprint 1 — thin vertical slice".
- `aamad.config.yml` — approved libraries, `visual_style: minimal`, `type_checking: true`,
  `max_file_lines: 400`.
- `.claude/rules/aamad-core.md`, `.claude/rules/adapter-claude-agent-sdk.md`.
- `data/fixtures/novamart_ci.duckdb` — schema and row values quoted in Results were read
  read-only from the committed CI fixture.

## Assumptions

1. The Next app lives at the repo root (SAD §3 permits "or repo-root Next app"); shared DTOs
   are reached through the `@shared/*` tsconfig path, not an npm workspace.
2. CSS modules, not Tailwind — Tailwind is not on the `aamad.config.yml` approved list.
3. `done{escalated}` is the client's landing state for `Aborted` as well, because the wire
   contract has no `aborted` status. The customer-visible text differs (error message), the
   status does not.
4. Trace metadata on response headers is acceptable until the `GET
   /api/conversations/:id/trace` route lands; nothing in the frozen contract forbids it.
5. `AS_OF_DATE` is pinned in eval/verification runs; with it unset, `shiftDays` moves by one
   per day and any absolute date in this spec's examples rots (SAD §4 consequence 3).

## Open Questions

1. **`duckdb` npm package substitution.** `aamad.config.yml` approves `duckdb`. That package
   (v1.4.4, node-pre-gyp) has no prebuilt binary for the installed Node 25 and its source
   build fails locally. The scaffold uses **`@duckdb/node-api` v1.5.5-r.4** — DuckDB's own
   Node-API client, same vendor, same engine. Recorded here per the "adding any other runtime
   dependency" rule; needs a one-line amendment to the approved list, or a pinned Node LTS
   (20/22) where the legacy `duckdb` package has prebuilds.
2. **No structured facts frame in `StreamEvent`.** Order status/dates/line items can only
   reach the UI as `token` text, so the Results area cannot render a typed order object
   without violating the freeze. `OrderSummary` exists in `dto.ts` as the tool-result summary
   shape; whether it should also be a stream frame is an Integration/Backend decision.
3. **`Aborted` is not observable on the wire.** Client disconnect and `turnTimeoutMs` are
   distinguishable server-side but arrive at the client as a dropped stream. If the operator
   trace needs the distinction, the contract needs an `error.code` convention.
4. **Retry semantics for `error.retryable: true`** are undefined in the SAD — the current UI
   shows the message and waits for the customer. Auto-retry would need a budget rule.

## Audit

| Field | Value |
| ----- | ----- |
| Persona id | `frontend-eng` |
| Action | `*develop-fe` (+ `*style-ui`, `*document-frontend`); 2026-08-13 status-visibility pass: crew banner, Run/Reset/Retry, README, spec change log |
| Timestamp | 2026-08-13 |
| Resolved runtime | `claude-agent-sdk` (`AAMAD_TARGET_RUNTIME`, matches `aamad.config.yml` → `runtime.target`) |
| Artifacts written | `frontend-functional-spec.md`, `packages/shared/src/dto.ts`, `app/`, `lib/` (incl. `lib/status.ts`), `server/data/`, `.env.example`, `README.md`, `project-context/2.build/frontend.md` |
| Verification | `npx tsc --noEmit` clean; `next build` clean; `curl` against real `/api/chat` for order ids 1 / 46101 / 42776 / 99999999 / no-identity; scripted browser pass covering keyboard-only entry, banner transitions idle→running→done, and Reset clearing the transcript (0 console errors) |
| Prompt Trace | Not captured — no LLM call exists in this slice; the reply is composed deterministically from the DuckDB tool result |
| Determinism | No model invoked; temperature/token controls N/A for Sprint 1 frontend + route |
