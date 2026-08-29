# Integration — NovaMart Multi-Agent Support Crew

Persona: `@integration.eng` · Actions: `*integrate-api`, `*verify-messageflow`, `*log-integration`
Epic reference: `.claude/rules/epics-index.md` → Integration (SAD: API & Flows, PRD: Int Req)

---

## Scope

Wire the chat UI to the runtime backend endpoint for the MVP chat flow, verify the round trip,
and record what the verification actually found.

**In scope.** `POST /api/chat` request/response contract, the SSE envelope, the engine seam,
client-side consumption, error and cancellation paths, `GET /api/health`, and — added in
Sprint 2 — `POST /api/conversations/:id/csat`, `GET /api/conversations/:id/trace`, the rate
limit, and the session/identity handoff between route and engine.

**Out of scope for this persona.** Agent prompts and tool implementations (`@backend.eng`),
UI layout and styling (`@frontend.eng`), evaluation coverage and defect triage
(`@qa.eng`), architecture decisions (`@system.arch`). Defects found below are **recorded, not
fixed** — writing to another persona's files would breach the AAMAD agent contract.

Status: **integration complete and re-verified on both engines, 2026-08-28.** Sprint 2 changed
the surface underneath this artifact — four more agents, two new endpoints, a rate limit, a
durable session, and a `csat_prompt` frame in the envelope — so the message-flow run was
executed again rather than amended. **18 cases, all observed.** Five findings recorded across
the two runs; **all five now resolved by the owning personas** — INT-03 closed 2026-08-29.

**`*integrate-api` re-run 2026-08-29.** The wiring was complete; the client's *description* of
it was not. Two contract defects found and fixed (INT-04, INT-05), and OQ-5 closed — the last
unmet item in the adapter's Quality Gates.

---

## Integration surface (`*integrate-api`)

### Transport

One endpoint carries the whole chat flow. `ADR-04` selects SSE over polling or WebSocket:
the turn is server-push only, nothing outlives the request, and a single envelope carries
both customer tokens and operator trace frames.

| Property | Value |
|---|---|
| Endpoint | `POST /api/chat` |
| Response | `text/event-stream; charset=utf-8` |
| Framing | `data: <json>\n\n`, one `StreamEvent` per frame |
| Cache | `no-cache, no-transform` |
| Rate limit | 20 turns/min/client (`RATE_LIMIT_PER_MIN`), `429` + `Retry-After` |
| Health | `GET /api/health` |
| CSAT write | `POST /api/conversations/:id/csat` |
| Operator trace | `GET /api/conversations/:id/trace`, `X-Operator-Key` |

Three endpoints joined the surface in Sprint 2, and only one of them is authenticated. That
asymmetry is deliberate and worth stating: `/api/chat` and the CSAT write are customer
surfaces on a localhost MVP; the trace endpoint returns the machinery behind a turn — hop
path, tools, cost, transcript, tickets — which is a different audience and a different risk.
It **fails closed**: with `OPERATOR_KEY` unset it answers `503` and reads nothing, so a
forgotten env var disables the endpoint rather than opening it (verified, case 15b).

**The client does not use `EventSource`.** `EventSource` issues GET with no body, and a turn
needs a request body (message, identity, flags). `lib/services/turnService.ts` therefore uses
`fetch` + a `ReadableStream` reader and splits frames on `\n\n` itself. Same wire format, no
`EventSource`. The tradeoff is losing its automatic reconnect, which is correct here: silently
replaying half a support turn is worse than failing it visibly.

### Request

```typescript
type ChatRequest = {
  conversationId?: string;       // server creates one if absent
  message: string;               // the only required field
  identity?: { userId?: number; orderId?: number };
  clientFlags?: { trace?: boolean };
};
```

Validation is duplicated on purpose. `lib/chatClient.ts` mirrors the server's rules so the
customer gets an instant message instead of a round trip; `app/api/chat/route.ts` re-checks,
because a client-side rule is a convenience and never a control.

**`identity` is now merged, not replaced** (Sprint 2, ADR-10). The route loads the stored
identity for the conversation and lets the request override it field by field: a customer who
gave an order id on turn 1 need not repeat it on turn 3, while one who names a *different*
order has changed the subject and the request wins. Verified in case 17 — turn 2 with no
identity at all answered about order 46101.

### Response headers

Trace metadata rides on the response so an operator can reconstruct a turn without parsing the
body.

| Header | Purpose |
|---|---|
| `X-Novamart-Conversation-Id` | Correlates to `project-context/2.build/logs/<id>.jsonl` |
| `X-Novamart-Engine` | Which engine served the turn |
| `X-Novamart-As-Of` | The turn's shifted "today" |
| `X-Novamart-Shift-Days` | Temporal offset applied |
| `X-Novamart-Overlay-Hit` | Whether a demo overlay matched |

### Event envelope

`StreamEvent` (`packages/shared/src/dto.ts`) is shared by client and server from one
definition, so the wire contract cannot drift between them.

Four properties are load-bearing and were verified rather than assumed:

1. **`done` is always last and always sent.** The route sets `terminated` on `done` and drops
   every later frame; an engine that returns without one gets a synthesized terminal frame. The
   client never has to guess whether a turn ended.
2. **The server owns terminal status.** `lib/chatClient.ts` states it directly: the client owns
   no turn semantics of its own.
3. **`agent_hop` / `tool_call` are operator-only**, gated behind `clientFlags.trace`. This is
   the wire-level expression of "the customer sees one assistant, not a crew". The TracePanel
   consumes exactly these frames, so with trace off the panel is **empty rather than
   filtered** — the split is enforced on the wire and the UI does not work around it.
4. **`csat_prompt` sits immediately before `done`, and only on a turn that finished.** Added
   in Sprint 2. It cannot come after `done` (nothing may), and the route withholds it entirely
   on `needs_input` — asking someone to rate an answer they have not been given is its own
   small insult. Verified on both engines and in both trace modes: cases 5, 6, 7, 10, 11, 13.

### Engine seam

`CHAT_ENGINE=deterministic|sdk` selects the implementation behind `TurnEngine`. Both satisfy
the same DTO. The route resolves the engine and pumps frames; it holds no turn logic.

### Failure and cancellation

- Malformed body → `400 {code, message}` as JSON, not SSE.
- Over the rate limit → `429 {code, message}` + `Retry-After`, checked **before** body parsing.
  What is being protected is the operator's API key on an unauthenticated endpoint, so the
  cheapest possible check goes first.
- Mid-turn failure → in-band `error` frame, then `done`, so the stream stays well-formed.
- Client disconnect → `cancel()` aborts the turn server-side.
- Turn timeout → `AbortController` at `turnTimeoutMs` (120s).

`send()` is total: it never throws. A dead stream drops frames rather than raising, because a
throw from inside engine code unwinds into the engine's own catch and gets reported as a turn
failure — the `ERR_INVALID_STATE` class of bug seen in the 2026-08-23 traces, where turns that
had already succeeded were logged as failures. **A disconnected client is a normal end to a
turn, not a fault.**

---

## Client-side contract pass (`*integrate-api`, 2026-08-29)

The UI has been wired to `/api/chat` since Sprint 1 and the round trip works. This action
therefore asked a narrower question — **does the client's stated view of the API match the API?**
— and the answer was no in three places. All three are the same shape: a declaration that was
true when written and never revisited, with a cast standing in for a check.

### INT-04 — `TurnTrace` described an endpoint that does not exist. **RESOLVED.**

`lib/services/turnService.ts` declared the operator-trace response as
`{ conversationId, temporal, hops: {agentId, hop}[], tools }`. The route returns
`{ conversationId, hops, turns, transcript, identity, csat, ticketStubs, traceRecordCount }`.
`temporal` and `tools` do not exist in the response at all, and `hops` carries a merged event
stream, not agent transfers.

The type was written in Sprint 1 as a placeholder beside a `getTurnTrace` that threw
"not implemented"; the route arrived on 2026-08-28 and nothing reconciled the two. Because
`getTurnTrace` **cast** the parsed JSON to that type, the compiler could not see the mismatch —
the first caller would have read `undefined` from `.temporal` with no error anywhere.

Fixed: the type now describes the actual payload, and `getTurnTrace` shape-checks the response
before returning it.

### INT-05 — the frontend mock had drifted from the wire. **RESOLVED.**

`lib/services/mockStream.ts` is the stand-in the contract-freeze gate names: the frontend
develops against it, so what it cannot produce is a surface nobody can build offline. It was
written for the Sprint 1 envelope and never revisited. Measured against the route, it:

- emitted **no `citation`** — so the Sources line could not be developed;
- emitted **no `csat_prompt`** — so the CSAT card could not be rendered at all;
- emitted **no `escalation`** — so the handoff copy and the ticket id had no offline path;
- emitted `agent_hop` / `tool_call` **unconditionally**, while the route withholds them unless
  the turn asked for a trace. A frontend built against that would have shown a customer the
  crew's internals, and the TracePanel's empty state could never be seen.

Fixed: the mock now mirrors the route including **what it withholds**, adds a money-intent
branch that escalates with a ticket, and supplies synthetic response headers so the trace
panel's metadata row is developable offline. Six tests assert the mock against the same
envelope properties this document asserts against the real server — `session` first, `done`
last and once, `csat_prompt` immediately before it and never on `needs_input`, trace frames
gated.

The freeze gate's rule was "a change to the DTO requires a re-check of the FE mock". This is
the inverse case and worth recording: **the DTO did not change and the mock still drifted,**
because frames were added to the SERVER that the mock was never taught to send. The gate as
written does not catch that. The tests now do.

### OQ-5 — `StreamEvent` validated at the client boundary. **CLOSED.**

`parseFrame` accepted any object carrying a `type` field and asserted it into the union. That
is safe exactly as long as the only producer is our own route handler — an assumption that
holds today and survives right up until a proxy, a replay tool, a mock, or a future non-Next
backend sits in between. A malformed frame would reach the FSM as a variant with undefined
fields and surface as a blank message or a missing terminal state, not as a parse error.

`packages/shared/src/streamEvent.ts` adds `parseStreamEvent`, beside the frozen contract it
validates. **It restates no shape**, so the freeze gate is untouched: a new variant means
editing the union *and* the validator, and a test asserts the union's arity so that a variant
added to one and not the other fails the build.

Hand-written rather than Zod, deliberately. Zod is already a dependency but only server-side,
where the SDK's `tool()` helper requires it; using it here would put a schema library in the
**client** bundle for nine object shapes. That is the same trade this project has declined
twice — `node:sqlite` over `better-sqlite3`, and no markdown renderer for the sake of bold
text. The validator is fifty lines with no dependencies and six tests, including one that
confirms a `__proto__` payload does not survive parsing.

A rejected frame is dropped and logged (`frame_rejected`), never thrown: one bad frame must not
kill a turn that is otherwise fine, and the envelope guarantees a `done` will still arrive.

### Verified

| Check | Result |
|---|---|
| Unit suite | **104 / 104** (was 92) — 6 validator, 6 mock-fidelity |
| Live sdk turn, trace on | `session → agent_hop → tool_call ×2 → citation → csat_prompt → done`, **zero `frame_rejected`** |
| Browser, real engine | Trace panel renders hops, tools, citations, terminal status; no console errors |
| Browser, `NEXT_PUBLIC_USE_MOCK_STREAM=1` | Refund → escalation with ticket, CSAT card, handed-off banner, populated metadata row — all offline. Screenshot: `docs/screenshots/06-mock-mode-envelope.png` |
| `npx tsc --noEmit` | exit 0 |

## Message flow verification (`*verify-messageflow`)

Executed **2026-08-28** against a running server, both engines. Every row is an observed
result. The 2026-08-27 run is superseded rather than deleted — its findings are preserved
below, and the cases it covered were all re-run.

**Environment.** `@anthropic-ai/claude-agent-sdk` 0.3.241 · `MODEL_ID=claude-sonnet-5` ·
`SDK_STREAM_MODE=live` · `AAMAD_TARGET_RUNTIME=claude-agent-sdk` · CI fixture DuckDB ·
six registered agents · sdk cases pinned at `AS_OF_DATE=2026-09-01` (`shiftDays=608`),
deterministic cases with the clock unpinned to exercise `asOf` resolution.

| # | Case | Expected | Observed | |
|---|---|---|---|---|
| 1 | Malformed JSON body | `400 invalid_json` | `400 {"code":"invalid_json",…}` | PASS |
| 2 | Missing `message` | `400 invalid_request` | `400 {"code":"invalid_request",…}` | PASS |
| 3 | Response headers | 5 `X-Novamart-*` + SSE content type + `no-cache, no-transform` | all present | PASS |
| 4 | `GET /api/health` | status, engine, duckdb — **plus the new stores** | `ok / sdk / duckdb ok / stores ok / operatorTrace enabled` | PASS |
| 5 | Envelope, trace ON | `session` first, `done` last, `csat_prompt` immediately before it | `session, agent_hop, tool_call, token ×4, citation, csat_prompt, done` | PASS |
| 6 | Envelope, trace OFF | no `agent_hop` / `tool_call` | `session, token ×6, citation, csat_prompt, done` | PASS |
| 7 | Escalation frame (sdk) | ticket + reason + `done:escalated` | `STUB-174683EB` / `payment_or_refund` / `escalated` | PASS |
| 8 | Unknown order (sdk) | honest reply; status matching the reply | correct text, **but `done:resolved` on a question — and a CSAT card with it** | **INT-03** |
| 9 | Client disconnect | turn aborts server-side, no side effects | `prompt_trace` only — no tool call, no ticket, no assistant turn stored | PASS |
| 10 | Deterministic WISMO | grounded reply, `resolved` | `agent_hop`, `tool_call`, `citation`, `csat_prompt`, `resolved` | PASS |
| 11 | Deterministic refund | escalation + ticket (ADR-16) | `escalation{STUB-D90F4F49, payment_or_refund}` + `escalated` | PASS |
| 11b | Deterministic "why was my order cancelled" | must NOT over-escalate | `resolved`, no escalation frame | PASS |
| 12 | `asOf` correctness (INT-02) | the server's LOCAL day | header `2026-08-28` at 19:55 CDT — **while UTC had already rolled to the 29th** | PASS |
| 13 | `needs_input` turn | no `csat_prompt` | `session → token ×21 → done{needs_input}`, CSAT not sent | PASS |
| 13b | Unknown order (deterministic) | status matching the reply | `done{needs_input}`, no CSAT — **the opposite of case 8 on identical input** | PASS |
| 14 | `POST …/csat` | 200 / 400 / 404 by input | `{"status":"ok"}` · `invalid_score` on 7 · `invalid_request` on `"five"` · `404` unknown id | PASS |
| 15 | `GET …/trace` auth | 401 without or with a wrong key | `401` / `401` / `200` with the right key | PASS |
| 15b | `GET …/trace`, `OPERATOR_KEY` unset | disabled, not open | `503 operator_key_unset` — **including with a guessed header** | PASS |
| 15c | Trace path traversal | no filesystem escape | `..%2f..%2f..%2fetc%2fpasswd` → `404` | PASS |
| 16 | Rate limit | `429` + `Retry-After` past the window | `400 400 400 429 429` at limit 3; `retry-after: 60` | PASS |
| 17 | Identity across turns | turn 2 with no identity still answers | answered about order 46101 from the stored session | PASS |
| 18 | Ticket durability | stub survives a restart | `STUB-4EA1AEDA` read back after `pkill` + restart | PASS |

**Case 12 is the strongest evidence INT-02 has yet had.** The fix was made and checked at
21:29 CDT on the day it was written; this run landed at 19:55 CDT, when the server's local
date was 2026-08-28 and the UTC date was already 2026-08-29. The header reported the local
day. Before the fix it would have reported tomorrow, and every shifted order date with it.

**Frame ordering survives the new frame.** `csat_prompt` was the first addition to the envelope
since the contract freeze, and it lands in the one position that cannot break the `done`-is-last
guarantee. Checked in six separate cases across both engines rather than once.

## Findings (`*log-integration`)

### INT-03 — A clarifying question is reported `resolved`, and now asks for a rating too. Severity: **medium**. **RESOLVED 2026-08-29**. *(new)*

**Resolution.** `@backend.eng` moved the decision to the runtime, per ADR-17. A turn that
attempted data lookups and got **no successful result** from any of them is `needs_input`,
whatever the reply says and whether or not the coordinator emitted the marker. Re-verified:
order `999999999` now returns `done{needs_input}` with **no `csat_prompt`**, matching the
deterministic engine on identical input, while a real order still resolves with its citation.
Eval 104/104, unit suite 135/135, deterministic engine unchanged.

The signal took two attempts to get right, and the reason is recorded in `backend.md`: the
outcome ledger cannot see a failing tool, because a tool that returns an error never reaches
`PostToolUse` at all.

Original finding:

Case 8. Order `999999999` on the sdk engine returns:

> "I couldn't find any order under the ID 999999999 in our system. Could you double-check the
> order number for me?"

…with `done{status:"resolved"}` and a `csat_prompt` frame. The **deterministic** engine, asked
the same thing (case 13b), returns `done{needs_input}` and **no** CSAT prompt.

This is DEF-04 (`qa.md`), but it is no longer only a status mismatch, and it is no longer only
QA's problem, which is why it is recorded here as a new integration finding:

1. **It is now a contract violation, not a divergence.** ADR-16 ruled terminal status part of
   the cross-engine contract and ADR-18 scoped that ruling to exactly this — status, not
   specialist coverage. Two engines returning different terminal status for identical input is
   precisely what those decisions forbid. When DEF-04 was filed, the question was open.
2. **The blast radius grew when CSAT landed.** The route withholds `csat_prompt` on
   `needs_input` — deliberately, because rating an unanswered question is insulting. That guard
   keys on the status, so a wrong status routes around it: the customer is asked "Did that
   answer your question?" underneath a question they have not answered yet. The guard is
   correct; it was handed the wrong input.
3. **The UI faithfully compounds it.** `lib/status.ts` maps `resolved` to the green *done* tone
   with "Answered from order data." A clarifying question therefore renders as a completed,
   successful turn, with a satisfaction survey attached. Every layer below is behaving as
   specified.

**Where the fix belongs.** Not here, and not in the client. The coordinator emits the
`<<NEEDS_INPUT>>` marker (`server/runtime/needsInput.ts`) and did not emit it on this turn —
model-emitted, so unguaranteed, exactly as `backend.md` gap 5 states. The runtime already
proves the shape of the answer for two other guarantees (ADR-17): a spent hop budget and an
unaided answer are both decided **after** the turn on what actually happened. A clarifying
question that reached a specialist and got `not_found` back is a third case of the same kind.
Owner: `@backend.eng`, with `@qa.eng` re-scoping DEF-04 to match.

### INT-01 — Deterministic engine never escalates. Severity: **medium**. **RESOLVED 2026-08-27**.

`"I want a refund"` on `CHAT_ENGINE=deterministic` returns the order summary plus the line
*"I can't process refunds, cancellations, or payments here."*, terminal status `resolved`, and
**no `escalation` frame and no ticket stub**. The same request on `sdk` opens `STUB-FEDA562C`
with `reason_code: payment_or_refund`.

Root cause is by construction, not a bug in the code: `server/runtime/engines/deterministic.ts`
is an order-lookup formatter that does not read intent. Every valid `orderId` receives the same
composed reply.

Why it matters: the deterministic engine is the **default** (`DEFAULT_ENGINE`) and the keyless
demo path. On it, a customer asking for a refund is never routed to a person, which is the
behaviour PRD F-ESC-01 exists to guarantee. The reply text is honest, so this is a capability
gap rather than a false statement — but it is a larger gap than DEF-05 describes, because DEF-05
is scoped to *terminal status* and records that "the customer-visible text is correct on both".
That holds; what is missing is the handoff itself.

**Resolution.** `@system.arch` ruled **ADR-16** (SAD §6, amended 2026-08-27): escalation is a
`TurnEngine` obligation, not an sdk-engine feature. Engines may differ in *how* they decide, not
in *whether* they route. `@backend.eng` implemented a money-vocabulary matcher
(`server/runtime/moneyIntent.ts`, import-free so it is unit-testable under the existing harness)
and a code-built escalation package in `deterministic.ts`.

Re-verified live: `"I want a refund"` on the deterministic engine now returns
`escalation{STUB-8EEF6C6C, payment_or_refund}` + `done{escalated}`. Regressions checked — plain
WISMO still `resolved`, and `"why was my order cancelled"` still `resolved` rather than
over-escalating. 5 new unit tests; suite 41/41.

### INT-02 — `asOf` is derived from UTC, not local time. Severity: **low**. **RESOLVED 2026-08-27**, and re-confirmed under the exact failing condition on 2026-08-28 (case 12).

`server/data/dateShift.ts` computes today via `new Date().toISOString().slice(0, 10)`, which is
the **UTC** calendar date. Observed at 21:29 CDT on 2026-08-27: `asOf=2026-08-28`,
`shiftDays=604`.

Consequence: for any customer west of UTC, in the evening the assistant states tomorrow's date
as today and every shifted order date moves with it — an order placed "today" reads as
"yesterday". It also makes `shiftDays` change at 19:00 CDT rather than midnight.

**Resolution.** `@backend.eng` split the two concerns in `dateShift.ts`. `toIsoDate` stays UTC —
it formats the UTC-midnight Dates the shift arithmetic is anchored on, and making it local would
have moved every shifted date back a day west of Greenwich. A new `todayIsoLocal()` supplies
`resolveAsOf` only.

Re-verified: `x-novamart-as-of: 2026-08-27` (was `2026-08-28`), `shiftDays 603` (was 604), and a
shifted order date still renders correctly — order 45538 reads "Placed 2026-08-25 (2 days ago)".
`AS_OF_DATE` still overrides for reproducible evals. Multi-region would need the customer's zone;
recorded as future work, not MVP.

### DEF-04 — `needs_input` under-fires on the sdk path. Severity: low → **superseded by INT-03**.

Recorded in `qa.md`, confirmed on two models across three runs (`claude-haiku-4-5`,
`claude-sonnet-5` twice), so it is not model-specific. Its scope has since widened — see INT-03
above, which restates it as a contract violation with a CSAT consequence.

### DEF-05 — Engine divergence on terminal status. Severity: low. **CLOSED 2026-08-27/28.**

Answered by **ADR-16** (terminal status IS part of the cross-engine contract) and bounded by
**ADR-18** (parity is on status, not on specialist coverage). The general question is settled;
the one remaining instance of divergence is INT-03, which is now a defect against that contract
rather than an open architectural question.

### Traceability defect — undocumented external integration. **RESOLVED 2026-08-27**.

`server/data/holidays.ts` cites *'SAD §4 "External systems / integration points", amended
2026-08-25'*. **No such amendment exists.** The SAD table (line 795) still lists only the
Anthropic API and the DuckDB file, with carriers and payments marked **Excluded**.

So the codebase now makes outbound calls to a third party (`date.nager.at`) that the
architecture does not record. This also conflicts with the `@integration.eng` persona rule
*"No external APIs or advanced integrations — MVP only!"*.

**Resolution.** `@system.arch` amended the SAD rather than removing the integration: **ADR-15**
added to the §1 decision table, and the §5 External systems table now records the Nager.Date
outbound dependency as *Optional — degrades*, with its four safety properties and the reason
carrier tracking was rejected in its place. The persona rule "no external APIs" is superseded for
this one integration by an explicit architecture decision, which is the sanctioned way to widen
scope under `aamad-core`.

---

## Runtime adapter compliance

Checked against `.claude/rules/adapter-claude-agent-sdk.md`.

| Requirement | Status |
|---|---|
| Explicit turn and token budgets, no implicit defaults | Met — all resolved in `config.ts` |
| Least-privilege `allowed_tools` per task | Met — `AGENT_TOOL_ALLOWLIST` |
| In-process MCP server for custom tools | Met — ADR-07 |
| Validate prerequisites, fail fast with Diagnostic | Met — `preflightSdkEngine()` before SDK import |
| Cancellation behaviour defined | Met — verified, case 9 |
| Trace logs under `2.build/logs`, secrets redacted | Met — `SECRET_KEY_PATTERN` in `trace.ts` |
| Retry / idempotency for replayable actions | Met — `withReadRetry`; ticket stubs idempotent on `conversationId + reason_code` |
| MCP availability validated before execution | Met — startup assertions |
| **Structured output contracts validated** | **Met 2026-08-29** — `EscalationPackage` server-side, `StreamEvent` at the client boundary via `parseStreamEvent`. No Quality Gate item remains unmet |
| Rate limiting on a spend-bearing endpoint | Met (new) — fixed window before body parsing; a **cost guard**, not access control |
| Operator surface authenticated and fail-closed | Met (new) — `X-Operator-Key`, `503` when unset, id sanitised before the filesystem |
| Durable state for replayable actions | Met (new) — ticket stubs in SQLite, idempotent on `conversationId + reason_code` via a UNIQUE INDEX |

---

## Sources

- `project-context/1.define/sad.md` — §4 API contracts (normative), line 513; External
  systems / integration points, line 795; ADR-04, ADR-07, ADR-09
- `project-context/1.define/prd.md` — F-ESC-01, NFR-ENG-02, Build-phase sequencing
- `project-context/2.build/backend.md` — engine seam, tool contract
- `project-context/2.build/qa.md` — DEF-04, DEF-05
- `project-context/2.build/frontend.md` — UI scope
- `.claude/rules/adapter-claude-agent-sdk.md`, `.claude/rules/aamad-core.md`,
  `.claude/rules/epics-index.md`
- `aamad.config.yml` — resolved runtime, language, testing preferences
- Code read: `app/api/chat/route.ts`, `app/api/health/route.ts`,
  `app/api/conversations/[id]/{csat,trace}/route.ts`, `lib/services/{turnService,csatClient}.ts`,
  `lib/chatClient.ts`, `lib/fsm.ts`, `lib/status.ts`, `lib/text.ts`,
  `components/{TracePanel,CsatPrompt}.tsx`, `packages/shared/src/dto.ts`,
  `server/runtime/{engine,session,rateLimit,escalation}.ts`,
  `server/runtime/engines/{select,sdk,deterministic}.ts`, `server/data/{dateShift,sqlite}.ts`
- Live verification: 12 cases against `localhost:3000`, both engines, 2026-08-27;
  **re-executed and extended to 18 cases, both engines, 2026-08-28**

## Assumptions

1. **Single origin.** UI and API are served by one Next.js process, so no CORS layer exists and
   none is required. This holds only while both are same-origin; a split deployment needs CORS
   before the URL leaves localhost.
2. **No authentication on `/api/chat`.** Still true, and still the right thing to flag. Two
   things changed on 2026-08-28: `OPERATOR_KEY` is no longer inert — it gates the trace
   endpoint and fails closed when unset — and a 429 rate limit now caps the spend an
   unauthenticated caller can cause. **The rate limit is not authentication.** It is
   per-process and keyed on a spoofable client address; it stops a runaway loop, not a
   determined caller. Acceptable for a localhost MVP; **not** acceptable once shared, because
   the endpoint still spends the Anthropic key for anyone who can reach it. Remains with
   `@security.eng` and `@devops.eng`.
3. Verification ran against the committed CI fixture DuckDB, not the 151 MB practice DB.
4. `MODEL_ID=claude-sonnet-5` at verification time. Routing behaviour on the sdk engine is
   model-dependent; DEF-04 was confirmed on this model as well as on `claude-haiku-4-5`.
5. **Ticket stubs are durable as of 2026-08-28** (ADR-10, `data/ticket_stubs.sqlite`) and
   survive a restart — verified in case 18. The holiday cache is still in-process and dies with
   it, which is correct: it is a cache of a third party's public calendar, not state.
   Both stores are single-node.
6. **Frontend consumption is now covered by automated tests** (2026-08-28). `lib/fsm.ts`,
   `lib/status.ts` and the render-time text handling have 22 unit tests, run by `npm test`
   through `scripts/test-resolver.mjs`. Frame *parsing* in `turnService` is still exercised only
   by live use — see Open Question 5, which is about the same seam.

## Open Questions

1. ~~**INT-01.**~~ **Closed 2026-08-27** by ADR-16 + implementation. See Findings.
2. ~~**INT-02.**~~ **Closed 2026-08-27** — server's local day, with `AS_OF_DATE` override retained.
3. ~~**Undocumented external integration.**~~ **Closed 2026-08-27** by ADR-15.
4. ~~**Is terminal `status` part of the cross-engine contract** (DEF-05)?~~ **Closed 2026-08-27** —
   ADR-16 rules that it is. `@qa.eng` should close DEF-05 and re-scope DEF-04, which remains open
   as an sdk-path-only issue (the coordinator not emitting the `needs_input` marker).
5. ~~**Should `StreamEvent` be validated at the client boundary?**~~ **Closed 2026-08-29** —
   `parseStreamEvent` in `packages/shared/src/streamEvent.ts`, hand-written, no new dependency,
   6 tests. See the client-side contract pass above. This was the last unmet item in the
   adapter's Quality Gates.
6. ~~**No client-side test harness.**~~ **Closed 2026-08-28** — 22 client tests cover the FSM
   contract, the status vocabulary and the text handling. The blocker was that Node could not
   resolve the `@shared` / `@/` aliases; `scripts/test-resolver.mjs` maps them for the test
   process only.
7. **Should the runtime decide `needs_input` rather than the model?** Raised by INT-03. ADR-17
   already established that terminal-state guarantees are enforced after the turn, on what
   happened, for the hop budget and for unaided answers. A turn whose only tool result was
   `not_found` and whose reply asks a question looks like the same class of case. Owner:
   `@backend.eng` / `@system.arch`.

## Audit

| Field | Value |
|---|---|
| Persona | `@integration.eng` |
| Actions | `*integrate-api`, `*verify-messageflow`, `*log-integration` |
| Timestamp | 2026-08-27; re-verified 2026-08-28; `*integrate-api` contract pass 2026-08-29 |
| Resolved runtime | `claude-agent-sdk` (env `AAMAD_TARGET_RUNTIME`, matches `aamad.config.yml` → `runtime.target`; no fallback, no warning) |
| Adapter rule loaded | `.claude/rules/adapter-claude-agent-sdk.md` |
| SDK version | `@anthropic-ai/claude-agent-sdk` 0.3.241 (declared `^0.3.241`) |
| Model at verification | `claude-sonnet-5`, `effort: low`, adaptive thinking |
| Budgets | `maxHops 4` · `maxModelTurns 12` · `turnTimeoutMs 120000` · `maxOutputTokens 4096` · `toolReadRetries 1` |
| Engines verified | `sdk` and `deterministic`, both runs |
| Agents live at verification | six — `triage-router`, `order-specialist`, `faq-policy`, `plus-specialist`, `returns-advisor`, `escalation-handoff` |
| Files written by `@integration.eng` | 2026-08-27/28: this file only. **2026-08-29 (`*integrate-api`)**: `packages/shared/src/streamEvent.ts` + test (new), `lib/services/turnService.ts`, `lib/services/mockStream.ts` + test (new), `lib/chatClient.ts`, `package.json` (test glob). All are the client/server seam this persona owns; no agent prompt, tool, UI component or backend route was touched |
| Template | None. `.cursor/templates/` has no integration template; headings derived from the persona contract and the SAD API & Flows reference. |
| Prompt Trace | Not captured. This action produced no model-generated artifact content — findings come from executed HTTP requests and code reads, both reproducible from the table above. Per `aamad-core`, the omission is stated here with its reason. |
| Verification evidence | 12 executed cases 2026-08-27; **18 executed cases 2026-08-28**, both engines; per-turn traces under `project-context/2.build/logs/` |
| Self-check | Required sections present: Sources, Assumptions, Open Questions, Audit. No Diagnostic raised. |

### Follow-through by owning personas — 2026-08-27

`@integration.eng` records findings; it does not fix them. Three were handed to their owners and
resolved the same day. Recorded here so this artifact stays the single narrative of the epic.

| Persona | Action | Files written |
|---|---|---|
| `@system.arch` | `*create-sad` (surgical amendment) — ADR-15, ADR-16, §5 External systems, §6 escalation ruling, amendment record | `project-context/1.define/sad.md` |
| `@backend.eng` | `*develop-be` — ADR-16 money-vocabulary escalation; INT-02 local-date fix | `server/runtime/moneyIntent.ts` (new), `server/runtime/moneyIntent.test.ts` (new), `server/runtime/engines/deterministic.ts`, `server/data/dateShift.ts` |

### Re-verification after Sprint 2 — 2026-08-28

The surface this artifact describes changed underneath it, so the run was repeated rather than
patched. What moved, and what it meant for integration:

| Change | Integration consequence |
|---|---|
| Four more agents registered | The envelope is unchanged; `agent_hop` simply names more agents. No DTO edit, so the contract-freeze gate held through the largest change of the build |
| `csat_prompt` emitted | The first new frame since the freeze. Verified it cannot displace `done` (cases 5, 6, 7, 10, 11) and is withheld on `needs_input` (case 13) |
| Durable sessions | `identity` is merged rather than replaced; a follow-up turn with no identity resolves (case 17) |
| Two new endpoints | One authenticated and fail-closed, one not — the asymmetry is documented above |
| Rate limit | New `429` path, checked before parsing |

**One thing did not change, and that is the finding.** No `StreamEvent` variant was added or
altered beyond `csat_prompt`, no field changed shape, and the client needed no edit to keep
working through a build that doubled the agent count and added three endpoints. That is the
contract-freeze gate (SAD, "Contract freeze gate") doing exactly what it was written to do.

**Verification after the fixes.** Unit suite 41/41 (5 new money-intent cases). `npm run eval:sdk`
37/37 on the sdk engine — unchanged, confirming no cross-engine regression. Deterministic engine
re-verified live: refund → `escalation{payment_or_refund}` + `done{escalated}`; plain WISMO still
`resolved`; `"why was my order cancelled"` still `resolved`, so the fix did not introduce
over-escalation; `asOf` now local (`2026-08-27`, `shiftDays 603`) with shifted dates still
rendering correctly.

**One near-miss worth recording.** The first INT-02 fix made `toIsoDate` local outright. That
would have regressed `shiftIsoDate`, which formats UTC-midnight Dates — every shifted order date
would have moved back a day west of Greenwich, turning a cosmetic off-by-one into a data defect.
Caught before it shipped by asking which callers depended on the UTC anchoring. The two concerns
are now separate functions with the reason documented at both.
