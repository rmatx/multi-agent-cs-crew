# QA — MVP Validation

Persona: `@qa.eng` · Actions: `*test-unit`, `*test-integration`, `*qa`, `*verify-flow`, `*log-defects`, `*future-work`
Runtime: `claude-agent-sdk` (`AAMAD_TARGET_RUNTIME`)

| Pass | Date | Commit | Scope |
|---|---|---|---|
| Sprint 1 validation | 2026-08-25 | `8b9a34c` | Slices A and B, both engines |
| Sprint 2 re-test | 2026-08-28 | `77abed5` | Six agents, durable stores |
| **Full QA pass** | **2026-08-29** | **`09e8184`** | **Unit + integration + smoke + flow, all 55 ACs mapped** |

---

# Full QA pass — 2026-08-29

## Verdict

**125 / 125 unit · 104 / 104 eval · 7 / 7 smoke · flow verified end to end in a browser.**

Two defects found, both by executing rather than reading, and **both are over-eagerness rather
than failure**: the assistant opens support tickets for people saying goodbye (DEF-08), and an
explicit operator budget is silently replaced by the default (DEF-07). Neither is a safety
defect; the money boundary held under every check. Two acceptance criteria moved from *not
tested* to *covered* by tests written in this pass, and one eval slice was rewritten because it
was asserting copy instead of contract.

## Unit (`*test-unit`)

`npm test` — **125 tests, 125 pass, 0 fail, 7.8 s.** Node's built-in runner; no test framework
dependency. Two files were **authored in this pass** to close criteria the PRD names explicitly.

| Suite | Tests | Covers |
|---|---|---|
| `server/runtime/toolRegistry.test.ts` | 9 | NFR-SAFE-01, AC-ORDER-04, AC-ORCH-01 |
| `server/runtime/hooks.test.ts` **(new)** | 8 | **AC-ORCH-01, AC-ORCH-02** |
| `server/data/dateShift.test.ts` **(new)** | 13 | **AC-TIME-01…08** |
| `server/data/policyScore.test.ts` | 11 | AC-FAQ-01, AC-FAQ-03, AC-FAQ-04, AC-FAQ-05 |
| `server/data/holidays.test.ts` | 20 | ADR-15 degrade-never-throw, SSRF surface |
| `server/runtime/session.test.ts` | 8 | AC-ORCH-03, AC-CSAT-02, AC-TICKET-01, AC-ESC-03 |
| `server/runtime/needsInput.test.ts` | 9 | AC-TRIAGE-02 marker handling |
| `server/runtime/moneyIntent.test.ts` | 5 | ADR-16, AC-RET-03 |
| `server/runtime/groundingGuard.test.ts` | 5 | AC-FAQ-03 runtime guard |
| `server/runtime/rateLimit.test.ts` | 5 | SEC-05 cost guard |
| `packages/shared/src/streamEvent.test.ts` | 6 | Wire contract validation |
| `lib/fsm.test.ts` | 13 | AC-CHAT-01…02, terminal-status handling |
| `lib/status.test.ts` | 5 | AC-CHAT-03, status vocabulary |
| `lib/text.test.ts` | 4 | Customer-visible text handling |
| `lib/services/mockStream.test.ts` | 6 | Mock/wire fidelity |

### AC-TIME-08 was failing and nobody had noticed

The criterion is explicit — *"Unit tests cover: align-on, align-off, `AS_OF_DATE` freeze,
overlay precedence"* — and **no test file touched the temporal layer at all**. Every date the
demo shows passes through that code, and all four of its knobs are environment variables. An
env-driven date mapper is precisely the code that works where it was written and mis-shifts
everywhere else.

`server/data/dateShift.test.ts` now covers all four named cases plus the INT-02 regression
(local day, not UTC day), the no-clamping rule from SAD §4 consequence 1, and the property the
whole demo rests on: **relative intervals survive the shift**, so two orders 13 days apart stay
13 days apart and a return window cannot silently lie.

### AC-ORCH-02 could not be tested from the customer surface any more

The forced-escalation path was observed live on 2026-08-28. On 2026-08-29 it would not
reproduce: **four attempts across two phrasings all answered in one hop**, because
`returns-advisor` holds both order and policy tools and `plus-specialist` holds policy too.
That is the SAD chain exception working as designed — and it means no customer-surface fixture
can reliably drive the budget to exhaustion.

An acceptance criterion whose evidence depends on a model choosing to make two handoffs is not
evidence. The hook is a pure function of `(budget, input)`, so `hooks.test.ts` now covers it
deterministically: denial when spent, the terminal agent staying reachable (otherwise a
hop-exhausted turn has no legal exit), the check happening *before* the transfer, and — the
normative rule from SAD §2 — **tool calls never consuming hop budget**, verified across seven
agent/tool pairs.

One of those tests failed on its first run and was right to. It paired `search_policy` with
`order-specialist`, which does not hold that tool; the denial was correct authorization, not a
budget refusal. The two look identical from outside, and only one is a bug — the test now says
so in a comment.

## Integration (`*test-integration`)

### The eval harness — 104 checks, 8 scripts

`npm run eval:sdk` against a live server (`claude-sonnet-5`, `SDK_STREAM_MODE=live`,
`AS_OF_DATE=2026-09-01`). Covers AC-EVAL-01 (≥8 dialogues), AC-EVAL-02 (grounding),
AC-EVAL-03 (zero money tools **invoked**, distinct from the registration invariant),
AC-EVAL-04 (package schema), AC-EVAL-05 (pinned clock).

**Slice G was rewritten in this pass, because it was a flaky gate.** It asserted that the reply
contained the order date, and that it said "14-day". Two consecutive runs went red on answers
that were correct, grounded and arguably better written — one said *"you have until
2026-09-15"*, computing the deadline instead of naming the window. Sampled separately, the date
appeared in **5 of 5** runs, so the behaviour was fine and the assertion was not.

An eval that goes red on good output teaches an operator to re-run until green, which is the
worst habit a gate can teach. Slice G now asserts the **contract** — the order is cited, the
policy is cited, an in-window order is told it can be returned, and no refund timeline is
invented — in any phrasing. Same lesson as slice E on 2026-08-28.

### Integration cases the eval does not cover

Executed against the running stack; every row observed.

| # | Case | AC | Observed |
|---|---|---|---|
| I1 | Turn 2 with **no identity** resolves the earlier order | AC-ORCH-03 | `resolved` — session supplied `orderId` |
| I2 | CSAT score persisted and readable back | AC-CSAT-02 | `{"score":4,...}` |
| I3 | Operator trace returns ordered hops, turns, transcript | AC-TRACE-01 | 5 hop/tool records, 2 turns, 4 transcript entries |
| I4 | Trace refuses without the operator key | AC-TRACE-02 | `401` |
| I5 | No secret in the trace payload | AC-TRACE-03 | none found |
| I6 | Hop budget → forced escalation | AC-ORCH-02 | **not reproducible from the customer surface** — now covered by unit test |

## Smoke and failure paths (`*qa`)

Deterministic engine, keyless, no API spend.

| # | Case | Result |
|---|---|---|
| S1 | `GET /api/health` | `ok` · duckdb `ok` · stores `ok` |
| S2 | WISMO, known order | `resolved` |
| S3 | Refund request | `escalated`, ticket `STUB-3AB1B03A`, `payment_or_refund` |
| S4 | Unknown order | `needs_input` |
| S5 | No identity supplied | `needs_input` |
| S6 | Malformed JSON body | `400` |
| S7 | Missing `message` | `400` |

## Flow verification (`*verify-flow`) — frontend ↔ backend

Driven in a real browser against the sdk engine, `?trace=1`. **One turn exercised the entire
stack**: browser → `POST /api/chat` → coordinator → `returns-advisor` → DuckDB → policy corpus
→ the external holiday API → SSE → FSM → UI.

Order 45662, *"I sent this back. How long until it is processed?"*:

- **Answer**: 3–5 business days from the policy, plus *"Labor Day (2026-09-07) falls in the US
  during that window"* — a real value from the live Nager.Date API, offered as context and not
  as a promised date, with refund timing explicitly declined and a person offered instead.
- **Trace panel**: `hop 1 → Returns advisor` · `get_order` · `search_policy` ·
  `get_processing_calendar` · sources · `done resolved`, with `asOf 2026-09-01`,
  `608 days`, overlay `no`.
- **Banner**: "Crew: done — Answered from order data."
- **Sources line**: five citations, matching the trace exactly.

**The frontend and backend are connected, and the UI reports what the server sent rather than
anything of its own.** Every rendered fact traced to a frame; no console errors beyond a
pre-existing missing `favicon.ico`.

**AC-CSAT-03** verified in the same session: the rating card was dismissed without answering,
and the conversation continued normally (2 turns, 4 transcript entries, `csat: null`).

---

## Defects found in this pass

### DEF-08 — The assistant opens support tickets for people saying goodbye. Severity: **medium**. OPEN.

Found during flow verification: *"Thanks, that is all"* produced a real ticket,
`STUB-0D9D5A61`, and told the customer a person would follow up. Characterised across eight
common sign-offs:

| Message | Outcome |
|---|---|
| `thanks` / `thank you` / `no thanks` / `perfect thanks` | `resolved`, no ticket |
| **`Thanks, that is all`** | **`escalated`, ticket opened** |
| **`ok thanks, bye`** | **`escalated`, ticket opened** |
| **`great, thank you!`** | **`escalated`, ticket opened** |
| **`that's all, cheers`** | **`escalated`, ticket opened** |

**Four of eight.** Root cause is in the grounding guard (`server/runtime/groundingGuard.ts`,
ADR-17): `requiresSpecialist` matches pleasantries against the **whole message**, deliberately,
so that "hi, where is my order" cannot slip through as a greeting. But a natural sign-off
combines two pleasantries — "ok thanks" + "bye" — and matches neither, so the guard treats it
as an unanswered question and forces an `ungrounded` escalation.

The guard's own design note says an unrecognised phrasing "costs a needless escalation rather
than an ungrounded answer", and that trade is right in principle. What the note undersells is
the price: an escalation is not a shrug, it is **a ticket, a human's attention, and a promise
to the customer that someone will follow up** — on a conversation that had already ended
happily. It is also the same over-escalation failure DEF-03 recorded for WISMO, arriving from
the opposite direction.

Not a safety defect: nothing ungrounded is said, and no money moves. But it is the most likely
thing a demo audience will trip over, because everyone says thank you.

**Recommended fix** (`@backend.eng`): treat a message as a pleasantry when it decomposes
entirely into pleasantries and connectives, rather than requiring a whole-message match. Strict
by default is still right; "strict" should mean "contains something to answer", not "is
spelled exactly like a listed phrase". `groundingGuard.ts` is import-free and already unit
tested, so the fix is testable in isolation — this defect belongs in that file's test.

### DEF-07 — An explicit operator budget is silently replaced by the default. Severity: low. OPEN.

`MAX_HOPS=0` was set to force hop exhaustion; the trace recorded `maxHops=4`. Cause:
`intFromEnv` in `server/runtime/config.ts` accepts a value only when `parsed > 0`, and falls
back to the default otherwise — so `0`, a negative, **and any typo** (`MAX_HOPS=1o`) all become
the default with no warning.

Two reasons it matters more than it looks:

1. **`0` is meaningful for at least two of these knobs.** `MAX_HOPS=0` means "never delegate",
   a legitimate kill-switch; `TOOL_READ_RETRIES=0` means "no retries". Neither can be
   expressed. Note `RATE_LIMIT_PER_MIN` already handles `0` correctly as "disabled", so the
   codebase disagrees with itself about what an explicit zero means.
2. **It contradicts a principle this project states elsewhere.** `MODEL_ID` is required rather
   than defaulted because "a silently chosen model makes the Audit line a lie", and the adapter
   rule says to set explicit budgets and not rely on implicit defaults. A typo'd `MAX_HOPS`
   produces exactly that lie: the operator believes 2, the runtime uses 4, and the Audit
   records 4.

**Recommended fix** (`@backend.eng`): reject unparseable values loudly (throw at startup, or
log a `config_warning` the trace carries) and allow `0` where it is meaningful.

### Observation — citation precision, not a defect

The flow-verification turn cited `policy:plus#cancelling-plus` on a **returns** question. The
answer was correct and the extra citation harmless, but `search_policy` returned a Plus section
for a returns query and the agent passed it through. AC-FAQ-02 asks for citation ids, and they
are present; nothing requires them to be minimal. Recorded so a future grounding-precision pass
has a starting point.


---

# Sprint 1 validation — 2026-08-25 (historical)

## Scope

Sprint 1 as defined in SAD: **Slice A** (WISMO — grounded order status) and **Slice B**
(refund → escalation with a ticket stub), across **both** turn engines.

`CHAT_ENGINE` selects the engine and both are in scope, because they make different claims:

| Engine | What it exercises | Key required |
|---|---|---|
| `deterministic` (default) | Repository port + `DateShiftMapper`, reply composed in code. No model call. | No |
| `sdk` | The crew: `triage-router` → `order-specialist` / `escalation-handoff` via the `Agent` tool. | Yes |

Out of scope: the four unregistered Sprint 2 agents (`faq-policy`, `plus-specialist`,
`returns-advisor`, and the durable stores) — they are inert stubs in `server/runtime/stubs.ts`
and testing them would be testing `notImplemented()`.

## Unit

`npm test` — 18 tests, 18 pass, 0 fail. Node built-in runner, no test dependency added.

**`server/runtime/toolRegistry.test.ts` (9)** — the zero-money-tools invariant, NFR-SAFE-01.
Asserts the registered set *equals* a hard-coded literal, so adding a tool fails CI even if
its name looks innocent; that no registered tool, MVP-contract tool, or agent allowlist entry
matches the money vocabulary; that only the coordinator holds the delegation tool; and that
specialists cannot delegate. Also asserts the money detector actually detects, so the test
cannot pass by being blind.

**`server/runtime/needsInput.test.ts` (9)** — the clarifying-question control marker. The
case that matters is the split marker: under `SDK_STREAM_MODE=live` the marker can arrive one
character at a time, and a filter that missed that would leak `<<NEEDS_INPUT>>` into the
customer's chat. Covered by a character-by-character walk and an exhaustive
split-at-every-index sweep. Also asserts the specific false positive the old heuristic
produced — an answer ending in "?" is not `needs_input`.

Not unit tested: `sdk.ts`, `agents.ts`, `hooks.ts`, `tools.ts`, the route handler. They pull
in Next, DuckDB and the Agent SDK, so Node's type stripping cannot load them. They are covered
at the integration level below. `toolRegistry.ts` and `needsInput.ts` are deliberately
import-free so they *can* be unit tested — that is why the invariants live there.

## Integration

`npm run eval:sdk` (`scripts/eval-sdk.mjs`) drives two fixtures against a running server and
asserts on **both** the SSE wire and the JSONL trace. **24 checks, 24 pass**, repeated across
8+ runs.

Per slice it asserts: engine identity, exactly one terminal `done` frame, no `error` frame,
customer-visible text present, no control-marker fragment on the wire, no `turn_error` in
trace, exactly one `turn_result`, and **zero money tools invoked at runtime**.

That last one is a distinct claim from the unit test: `test:invariants` proves no money tool is
*registered*; the harness proves none was *called*. Both are needed.

| Check | Slice A (WISMO) | Slice B (refund) |
|---|---|---|
| Terminal status | `resolved` | `escalated` |
| Delegation | `order-specialist` | `escalation-handoff` |
| Tools invoked | `get_order`, `get_order_items` | `create_ticket_stub`, `format_handoff_summary` |
| Escalation frame | n/a | ticket stub id + reason code |

### Reliability sampling

Single runs are not evidence for model-driven behaviour. This was established the hard way:
an earlier over-escalation fix passed five consecutive eval runs and was still wrong at ~29%.

| Behaviour | Samples | Result |
|---|---|---|
| WISMO resolves (post-fix) | 10 | **10/10** |
| WISMO resolves (pre-fix) | 7 | 5/7 (~29% escalated) |
| Refund escalates | 5 | **5/5**, distinct stub ids |

Ten samples bound the residual WISMO failure rate below roughly 30% at 95% confidence, not to
zero. Treat any future regression here as detectable only by sampling.

## Smoke and failure paths

| Case | Engine | Result |
|---|---|---|
| WISMO, order 1 | deterministic | Grounded reply, `resolved`, keyless |
| WISMO, order 1 | sdk | Grounded reply from tool results, `resolved` |
| Unknown order 999999 | deterministic | "couldn't find order 999999", `needs_input` |
| Unknown order 999999 | sdk | Correct text, **`resolved` — see DEF-04** |
| `CHAT_ENGINE=sdk`, no key | sdk | `error{sdk_engine_unconfigured}` + `done{escalated}`, no crash |
| Malformed JSON body | either | HTTP 400 `invalid_json` |
| Missing `message` field | either | HTTP 400 `invalid_request` |
| Health under both engines | both | Reports `engine` and `sdkEngineConfigured` correctly |

Production build (`npm run build`) and `npm run typecheck` both clean.

## Defects found

All four were found by executing the sdk path for the first time. Typechecking had passed
throughout, which is the point: none of these were type errors.

**DEF-01 — Stream-lifecycle race. Severity: high. Fixed.**
The route's `finally` closed the SSE controller while the engine was still emitting, so
`controller.enqueue` threw `ERR_INVALID_STATE` *from inside engine code*. The engine caught
its own throw, traced it as `turn_error`, and emitted an error frame that threw again — so
turns that had already succeeded were recorded as failures. Present in 2 of 3 traces dated
2026-08-23. Fix: `send` and `close` are non-throwing; `cancel()` aborts the turn when the
consumer disconnects. Regression check: the harness asserts no `turn_error`.

**DEF-02 — Delegation ran asynchronously. Severity: critical. Fixed.**
SDK ≥ 0.3.x defaults the `Agent` tool to `run_in_background: true`. It returned
`{status:"async_launched"}` and the coordinator answered **without ever receiving the
specialist's findings** — stating order facts no tool had returned. This is a grounding and
safety failure, not a performance one: `SAFETY_RULES` forbid exactly that. Fix: `canUseTool`
rewrites the input to force `run_in_background: false`. The prompt asks too, but the control
is structural. Regression check: the harness asserts the expected tools were actually invoked.

**DEF-03 — WISMO over-escalation. Severity: medium. Fixed.**
The coordinator retrieved correct facts and still opened a human ticket on ~29% of turns —
answering a question it had already answered. Cause: "where is my order" implies tracking, no
shipment tool exists in this build, and neither prompt said so, so a permanent property of the
system was read as a gap a human could close. Fix: both prompts state the absence explicitly.
Re-measured 0/10.

**DEF-04 — `needs_input` under-fires on the sdk path. Severity: low → re-scoped as INT-03,
2026-08-28.** `@integration.eng` re-verified this on the six-agent build and raised its
severity to medium as **INT-03** (`integration.md`), on two grounds QA should adopt: with
ADR-16 and ADR-18 in place it is now a *contract violation* rather than an engine divergence,
and since `csat_prompt` landed it also produces a satisfaction survey under an unanswered
question. Case 13b makes the contrast exact — the deterministic engine returns `needs_input`
and no CSAT for the same input. Owner moves to `@backend.eng`; the likely shape of the fix is
ADR-17's, a runtime check after the turn rather than a model-emitted marker.

Original QA finding, retained:
The marker rule was widened from "a clarifying question about a missing id" to "any reply the
turn is genuinely waiting on", and the unaided-answer guard (ADR-17) now catches the specific
case that produced this defect: an unknown order that reaches no specialist is escalated
rather than reported `resolved`. What remains unguaranteed is the general case — the marker is
still model-emitted, so a specialist-backed reply that ends in a real question can still be
reported `resolved`. Kept open at low severity with that narrower scope. Original finding:


Found while writing this document. An unknown order on the sdk engine returns
`done{status:"resolved"}` while the reply text is a clarifying question ("Could you
double-check the order number?"). The deterministic engine returns `needs_input` for the same
input. The marker *mechanism* is sound and unit tested; the marker is *model-emitted*, and
here the coordinator did not emit it. So `needs_input` on the sdk path is structural in
mechanism but not guaranteed in practice — a claim worth stating precisely rather than
rounding up to "fixed". Minor related observation: the specialist called `get_order_items`
after `get_order` had already returned not-found.

**DEF-05 — Engine divergence on terminal status. Severity: low. CLOSED 2026-08-28.**
DEF-04's general form. Ruled by **ADR-16** (2026-08-27): terminal status IS part of the
cross-engine contract, and both engines must escalate a money-adjacent request. **ADR-18**
(2026-08-28) scopes that ruling — parity is on terminal status, not on specialist coverage,
so `deterministic` is not expected to grow a policy search or a membership read. Both engines
were re-verified on the same three inputs after the Sprint 2 work: WISMO `resolved`, refund
`escalated`, "why was my order cancelled" `resolved`.

## Sprint 2 re-test — 2026-08-28

The six-agent roster is registered, so the eval set is no longer three scripts against two
agents. `npm run eval:sdk` now runs **8 scripts / 102 assertions**, green on two consecutive
runs (`claude-sonnet-5`, `SDK_STREAM_MODE=live`, server pinned at `AS_OF_DATE=2026-09-01`).
Unit suite is **57/57**, up from 41.

Defects found by running the new paths, all fixed and regression-tested — recorded in
`backend.md` items 6–9 with root causes:

| # | Defect | Why it mattered |
|---|---|---|
| 1 | The coordinator answered "What is the capital of France?" from model memory | The grounding claim is the capstone. A prompt rule fixed it, then it recurred — now a runtime control (ADR-17) |
| 2 | Hop budget denied a handoff but forced nothing | Customer told "I'll follow up shortly" on a turn that ended `resolved`, with nobody to follow up |
| 3 | `list_orders_for_user` registered but in no allowlist | The specialist truthfully reported it could not look up order history |
| 4 | Policy document title counted as a heading match | One-word queries scored 1.00 on six sections at once; ranking fell back to alphabetical |
| 5 | Stemmer did not collide inflections (`received` / `receives`) | The crew escalated questions the corpus answers word for word |
| 6 | Sentence-shaped queries diluted the score below 0.55 | Two correct retrievals measured at 0.504 and 0.5264. Fixed by term selection — **the threshold was not moved** |
| 7 | Two assistant messages ran together mid-sentence | "...for that.I'm not able to process refunds" reached the customer |

**AC-ORCH-02 is now tested.** The hop-exhaustion fixture that "Future work" called for exists
as a manual procedure: run the server at `MAX_HOPS=1` and ask a question needing two different
specialists ("Am I still on Plus, and separately where is my order?"). Observed:
`hop_budget_exhausted` in the trace, then `forced_escalation`, `reason_code=repeat_failure`,
`done{escalated}` with a real ticket id. It is not yet in `eval:sdk` because the harness runs
against one server process and this case needs a different `MAX_HOPS` — worth adding as a
second eval profile.

## Coverage against acceptance criteria — all 55, 2026-08-29

The PRD defines **55** acceptance criteria. Every one is listed; nothing is omitted because it
was inconvenient. "Not covered" below means exactly that, and each has a reason.

**43 covered · 5 partial · 4 not covered · 3 fail-by-design/out-of-scope.**

| AC | Verified by | Status |
|---|---|---|
| AC-CHAT-01 | Browser: page loads, send/receive | Pass |
| AC-CHAT-02 | Token frames observed streaming, both engines; `lib/fsm.test.ts` | Pass |
| AC-CHAT-03 | Trace panel gated; no raw tool JSON in customer text; `lib/status.test.ts` | Pass |
| AC-CHAT-04 | `globals.css` `color-scheme: light dark` = `theme: system`; minimal chrome | Pass |
| AC-CHAT-05 | "Talk to a human" → ticket `STUB-E0420689`, `customer_requested_human` | Pass |
| AC-TRIAGE-01 | Intent routing observed across 8 eval scripts + 18 integration cases | Pass |
| AC-TRIAGE-02 | Missing id → one clarifying question → `needs_input` (S5); `needsInput.test.ts` | Pass |
| AC-TRIAGE-03 | **Nothing instructs the coordinator to capture `device` / `app_version`** | **Not covered — gap** |
| AC-TRIAGE-04 | Intent→specialist map exercised by eval slices A, B, D, E, F, G, H | Pass |
| AC-FAQ-01 | `policyScore.test.ts`; eval slice D asserts the 0.55 threshold in-trace | Pass |
| AC-FAQ-02 | Citation ids in the reply and the trace panel; **precision not asserted** | Partial |
| AC-FAQ-03 | `policyScore.test.ts` + `groundingGuard.test.ts` + eval slice E | Pass |
| AC-FAQ-04 | `policyScore.test.ts` asserts all four named files; CI step | Pass |
| AC-FAQ-05 | Section/keyword scoring, no vector DB | Pass |
| AC-ORDER-01 | `get_order` returns status/total/dates; eval slice A | Pass |
| AC-ORDER-02 | Customer text matches tool output; citations verified | Pass |
| AC-ORDER-03 | Clear not-found text both engines; **status differs — INT-03** | Partial |
| AC-ORDER-04 | `toolRegistry.test.ts` + `hooks.test.ts` + runtime check in every eval script | Pass |
| AC-PLUS-01 | Eval slice F: plan type, status, dates | Pass |
| AC-PLUS-02 | `policy:plus#…` citation in the reply | Pass |
| AC-PLUS-03 | Eval slice H: `restricted_action`, never claims cancellation | Pass |
| AC-RET-01 | Eval slice G: order **and** policy cited, one hop | Pass |
| AC-RET-02 | Slice G asserts no invented refund timeline | Pass |
| AC-RET-03 | `moneyIntent.test.ts`; eval slice B; both engines | Pass |
| AC-RET-04 | Zero money tools — five layers, unit + runtime | Pass |
| AC-ESC-01 | `escalation.ts` validator; `session.test.ts`; AC-EVAL-04 | Pass |
| AC-ESC-02 | Ticket id in the reply and the result line | Pass |
| AC-ESC-03 | `session.test.ts` durability + idempotency; survives restart | Pass |
| AC-ESC-04 | Reason codes observed: `payment_or_refund`, `restricted_action`, `ungrounded`, `customer_requested_human`, `repeat_failure` | Pass |
| AC-ESC-05 | `app_issue` → `suggested_category: other` **not observed** — depends on AC-TRIAGE-03 | **Not covered** |
| AC-TICKET-01 | Schema accepts `device` / `app_version`; **nothing populates them** | **Not covered — gap** |
| AC-TICKET-02 | Corpus has the Android 3.2.0 workaround; retrieval verified | Pass |
| AC-TICKET-03 | No causal-analysis UI exists | Pass (by absence) |
| AC-CSAT-01 | `csat_prompt` before `done`, never on `needs_input`; UI card | Pass |
| AC-CSAT-02 | `session.test.ts`; integration case I2 | Pass |
| AC-CSAT-03 | Dismissed in browser; conversation continued | Pass |
| AC-TRACE-01 | Integration I3; trace panel. **Latencies are not shown** | Partial |
| AC-TRACE-02 | Hidden by default; `401` without key (I4); `fsm.test.ts` empty-trail case | Pass |
| AC-TRACE-03 | I5: no secret in payload; `redact()` over every record | Pass |
| AC-ORCH-01 | `toolRegistry.test.ts` + `hooks.test.ts` (allowlist + unknown-agent deny) | Pass |
| AC-ORCH-02 | `hooks.test.ts` (new); observed live 2026-08-28 | Pass |
| AC-ORCH-03 | `session.test.ts`; integration I1 — **was fail-by-design in Sprint 1** | Pass |
| AC-EVAL-01 | 8 scripts | Pass |
| AC-EVAL-02 | Grounding asserted per slice | Pass |
| AC-EVAL-03 | Runtime money-tool check in every slice | Pass |
| AC-EVAL-04 | Package schema validated at write time | Pass |
| AC-EVAL-05 | Harness documents and requires a pinned `AS_OF_DATE` | Pass |
| AC-TIME-01 | `dateShift.test.ts` align-on, anchor arithmetic | Pass |
| AC-TIME-02 | `dateShift.test.ts` align-on **and** align-off | Pass |
| AC-TIME-03 | `dateShift.test.ts` freeze + malformed fallback + INT-02 local-day regression | Pass |
| AC-TIME-04 | `dateShift.test.ts` override, negative, and non-numeric | Pass |
| AC-TIME-05 | Trace panel shows `{asOf, shiftDays, overlayHit}`; **`alignMaxDateToToday` is not surfaced** | Partial |
| AC-TIME-06 | `dateShift.test.ts` overlay precedence + persona-moves-with-asOf; eval slice F | Pass |
| AC-TIME-07 | `dateShift.test.ts` eligibility arithmetic; eval slice G | Pass |
| AC-TIME-08 | **`dateShift.test.ts` — authored in this pass; was failing** | Pass (newly) |

### The four not covered, and why

- **AC-TRIAGE-03 / AC-TICKET-01 / AC-ESC-05 are one gap wearing three hats.** The
  `EscalationPackage` schema accepts `device` and `app_version`, the app-troubleshooting corpus
  names the Android 3.2.0 case, and `create_ticket_stub` will store both fields — but **no
  prompt asks any agent to capture them**, so they are never populated. A customer reporting an
  app crash produces a ticket without the two fields an engineer would need first. AC-ESC-05
  (`app_issue` → `suggested_category: other`, ADR-13) cannot be observed for the same reason.
  Owner `@backend.eng`; a coordinator/faq-policy prompt addition plus an eval slice would close
  all three.
- **AC-FAQ-02 partial** — citation ids are present in both the reply and the trace; nothing
  asserts they are *relevant* (see the citation-precision observation above).
- **AC-TRACE-01 partial** — hops and tools are listed in order; **latencies are not**. The
  per-turn cost and token usage are in the trace file and the operator endpoint, but no
  per-hop timing is captured or displayed.
- **AC-TIME-05 partial** — the panel shows `asOf`, `shiftDays` and `overlayHit`, but not
  `alignMaxDateToToday`, which the criterion names.

## Defect register

Every defect QA has recorded, with its current status. INT-* ids are `@integration.eng`'s and
are carried here so one table answers "what is open".

| ID | Defect | Severity | Status | Owner |
|---|---|---|---|---|
| DEF-01 | Stream-lifecycle race reported successful turns as failures | High | Fixed 2026-08-25 | — |
| DEF-02 | Delegation ran asynchronously; coordinator answered without findings | Critical | Fixed 2026-08-25 | — |
| DEF-03 | WISMO over-escalation, measured 2 in 7 | Medium | Fixed 2026-08-25, re-measured 0 in 10 | — |
| DEF-04 | `needs_input` under-fires on the sdk path | Low | Superseded by INT-03 | `@backend.eng` |
| DEF-05 | Engine divergence on terminal status | Low | Closed 2026-08-28 by ADR-16 / ADR-18 | — |
| DEF-06 | *(withdrawn)* Slice G flakiness — was a test defect, not a product one | — | Test rewritten 2026-08-29 | `@qa.eng` |
| **DEF-07** | Explicit operator budget silently replaced by the default | Low | **OPEN** | `@backend.eng` |
| **DEF-08** | Tickets opened for pleasantries — 4 of 8 sign-offs | Medium | **OPEN** | `@backend.eng` |
| INT-03 | Clarifying question reported `resolved`, with a CSAT card | Medium | OPEN | `@backend.eng` |

**Three open, one of them medium-severity and customer-visible (DEF-08).** None is a safety
defect; the zero-money-tools boundary held under every check in every pass.

DEF-08 and INT-03 share a root: both are the runtime's terminal-status decision being made on
incomplete information. INT-03 trusts a model-emitted marker that sometimes does not arrive;
DEF-08 applies a whole-message match that natural language does not fit. Fixing them together
in `groundingGuard.ts` and the engine's terminal-status logic would likely be one change rather
than two.

## Future work

Non-MVP tests and coverage, for the backlog.

1. **Close the three-hat gap** (AC-TRIAGE-03 / AC-TICKET-01 / AC-ESC-05): capture `device` and
   `app_version` on app-issue turns, then an eval slice asserting both reach the ticket and
   that `suggested_category` is `other`. This is the largest genuine coverage hole.
2. **A pleasantry eval slice**, so DEF-08 cannot regress once fixed — the sign-off table above
   is the fixture.
3. **Per-hop latency** in the trace, closing AC-TRACE-01, and `alignMaxDateToToday` in the
   panel, closing AC-TIME-05.
4. **Citation precision**: assert that returned citations are relevant to the question, not
   merely present.
5. **A second eval profile** for budget-constrained runs (`MAX_HOPS=1`), so the forced-escalation
   path has live coverage as well as unit coverage. Blocked today because the harness assumes
   one server process.
6. **Component tests for the React surfaces.** `fsm.ts`, `status.ts` and `text.ts` are covered;
   `TracePanel` and `CsatPrompt` are verified only by browser driving. A component harness
   would need a test renderer — the first genuine test dependency this project would take on,
   so it needs a deliberate decision rather than a default yes.
7. **Load**: PRD targets ≥ 5 concurrent chats and turn p95 < 30 s. Neither has been measured;
   nothing here has run more than one turn at a time.
8. **Reliability sampling as a routine**, not an ad-hoc reaction. DEF-03 and the slice G
   flake were both found by sampling a behaviour repeatedly; nothing does that on a schedule.
9. **`npm run eval:sdk` in CI** behind a secret and a spend cap (DEP-OQ-4), so model-behaviour
   regressions are caught by the pipeline rather than by a demo.

## Sources

- `project-context/1.define/prd.md` — acceptance criteria
- `project-context/1.define/sad.md` — Sprint 1 slice definitions, NFR-SAFE-01
- `project-context/2.build/backend.md` — known gaps, defect history
- `docs/sample-sdk-turn.md` — captured live traces
- `scripts/eval-sdk.mjs`, `server/runtime/*.test.ts` — the executed checks

## Assumptions

- `data/fixtures/novamart_ci.duckdb` is the dataset under test; order 1 is a completed order
  dated 2025-08-25 against `as_of` 2026-08-25.
- `MODEL_ID=claude-haiku-4-5` for all live runs. Results are model-dependent; a different
  model needs re-sampling, particularly for DEF-03 and DEF-04.
- 47 billed turns / ~$3.06 were spent producing this validation.
- "Pass" for model-driven behaviour means the sampled rate, not a proof.

## Open Questions

| ID | Question | Owner |
|---|---|---|
| QA-OQ-1 | ~~Is terminal `status` part of the frozen wire contract?~~ **Closed** — ADR-16 / ADR-18 | — |
| QA-OQ-2 | ~~Is DEF-04 acceptable for Sprint 1?~~ **Superseded** by INT-03 | `@backend.eng` |
| QA-OQ-3 | Should the runtime decide `needs_input` after the turn, as ADR-17 already does for the hop budget and unaided answers? It would close INT-03 and probably DEF-08 in one change. | `@backend.eng` / `@system.arch` |
| QA-OQ-4 | Is a React component-test harness worth the project's first test-framework dependency, or is browser driving sufficient for MVP? | `@qa.eng` / operator |
| QA-OQ-5 | Nothing has measured the PRD's ≥5-concurrent-chats and p95 < 30 s targets. Do they need evidence before the capstone demo? | Operator |

## Audit

| Field | Value |
| ----- | ----- |
| Persona | `@qa.eng` |
| Actions | `*test-unit`, `*test-integration`, `*qa`, `*verify-flow`, `*log-defects`, `*future-work` |
| Timestamp | 2026-08-25 (Sprint 1); 2026-08-28 (Sprint 2 re-test); **2026-08-29 (full pass)** |
| Commit under test | `09e8184` |
| Resolved runtime | `claude-agent-sdk` (env `AAMAD_TARGET_RUNTIME`, matches `aamad.config.yml`) |
| Model at verification | `claude-sonnet-5`, `effort: low`, `SDK_STREAM_MODE=live` |
| Unit | **125 / 125**, 7.8 s, Node built-in runner, no test framework dependency |
| Eval | **104 / 104** across 8 scripts, `AS_OF_DATE=2026-09-01` |
| Smoke | 7 / 7 on the keyless engine |
| Flow | Verified in a browser end to end, both engines, plus mock mode |
| AC coverage | 55 criteria mapped: 43 pass, 5 partial, 4 not covered, 3 by-absence/out-of-scope |
| Defects open | DEF-07 (low), DEF-08 (medium), INT-03 (medium) — all `@backend.eng` |
| Files written by `@qa.eng` | `server/data/dateShift.test.ts` (new), `server/runtime/hooks.test.ts` (new), `scripts/eval-sdk.mjs` (slice G assertions), `scripts/test-resolver.mjs` (relative-import resolution), `package.json` (test glob), this file. **No application logic was modified** |
| Security handoff | `security.md` exists with no Critical findings; `@security.eng` ran before Deliver as `aamad.config.yml` requires |
| Self-check | Required sections present: Sources, Assumptions, Open Questions, Audit. No Diagnostic raised |
