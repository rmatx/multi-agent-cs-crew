# QA — MVP Validation

Persona: `@qa.eng` · Actions: `*test-unit`, `*test-integration`, `*qa`, `*verify-flow`, `*log-defects`, `*future-work`
Runtime: `claude-agent-sdk` (`AAMAD_TARGET_RUNTIME`)

| Pass | Date | Commit | Scope |
|---|---|---|---|
| Sprint 1 validation | 2026-08-25 | `8b9a34c` | Slices A and B, both engines |
| Sprint 2 re-test | 2026-08-28 | `77abed5` | Six agents, durable stores |
| **Full QA pass** | **2026-08-29** | **`09e8184`** | **Unit + integration + smoke + flow, all 55 ACs mapped** |
| **Re-test + first latency measurement** | **2026-09-04** | **`f0bbcc2`** | **Unit + eval + smoke re-run on the observability build; p95 measured** |
| **Demo-readiness pass** | **2026-09-04** | **`62e7970`** | **Unit + eval + smoke on the demo build; DEF-09 found and fixed; first added runtime dependency** |

---

# Demo-readiness pass — 2026-09-04

## Verdict

**160 / 160 unit · 114 / 114 eval · 8 / 8 smoke.** One defect found and fixed in this pass
(**DEF-09**, a wrong answer rather than a crash). The build changed substantially since the
morning re-test — vendor trace export, handoff artifacts, a demo surface, and the project's
first added runtime dependencies — so this pass exists to say what is now true rather than to
re-confirm what already was.

## DEF-09 — Returns eligibility ignored what was in the box. Severity: **medium**. FIXED.

**Found by reading the data against the policy, not by a failing test** — which is why no
existing check caught it. `data/policy/returns.md` excludes opened personal-care and hygiene
products from returns regardless of date. 82 of 500 products are `beauty`. `returns-advisor`
decided eligibility from the 14-day window alone, so an in-window order containing such an item
was told **yes** outright. Order 44279 (7 days old, contains a supplement) is one of several
reproducing cases.

Root cause was a single prompt line: *"Add get_order_items only when the customer asks what is
in the order."* On a returns question the advisor was instructed NOT to read the items, so no
category could reach it even once one existed. The codebase had already learned this lesson
from the opposite direction — the comment immediately below that line records `order-specialist`
losing context to an optional tool at low effort. Here the same optionality produced a wrong
answer instead of a thin one.

**Fix** (`@backend.eng`, one column and one instruction): `getOrderItems` now selects
`p.category` — deliberately not `price` or `cost`, which the crew has no business seeing — and
the advisor is told eligibility has two halves. No new tool and no allowlist change was needed:
`returns-advisor` already held `get_order_items`.

**Verified live.** Before: an unqualified yes. After: *"you're eligible based on timing… one
note: the order includes an ImmunePlus Supplements item, and if it's been opened,
supplement/personal-care items are sometimes excluded regardless of the date. The shoes and
lighting item don't have that concern."*

## Unit (`*test-unit`)

`npm test` — **160 tests, 160 pass, 0 fail, 7.9 s.** Up from 153; the six new tests are the PII
scrubber and retention window added with the SEC-03 mitigation.

## Integration (`*test-integration`)

`npm run eval:sdk` — **114 / 114 across all 9 scripts**, re-run *because* this pass changed a
prompt slice G asserts on. **Slice G still holds `hops === 1`**: the added `get_order_items`
call is same-agent, so it costs a tool call and not a hop, and *"an in-window order is told it
can be returned"* still passes because a qualified yes is still a yes. That assertion surviving
a behaviour change it was not written for is the strongest evidence the slice tests a contract
rather than a phrasing.

## Smoke (`*qa`) — keyless, no API spend

| # | Case | Result |
|---|---|---|
| S1 | `GET /api/health` | `ok` · duckdb `ok` · stores `ok` |
| S2 | WISMO, order 46101 | `resolved` |
| S3 | Refund | `escalated`, `payment_or_refund` |
| S4 | Unknown order | `needs_input` |
| S5 | No identity | `needs_input` |
| S6 | Malformed JSON | `400` |
| S7 | Missing `message` | `400` |
| S8 | **Handoff artifacts written** | ticket packet + `data/outbox.md` present |

S8 is new. Escalation is structural on both engines (ADR-16), so the artifacts are too — they
appear on the keyless path, which is what makes a zero-spend rehearsal show the whole handoff.

## What changed under this build, and what QA is asserting about it

**Arize trace export.** `server/runtime/openinference.ts` replays each finished turn as an
OpenInference span tree. Verified in Arize: `AGENT novamart.turn → CHAIN <specialist> → TOOL
<tool>`, every span carrying an explicit OK/ERROR status rather than `UNSET`. It is a REPLAY —
built after the turn from records `trace.ts` already writes — so QA's interest is narrow and
met: nothing on the turn's hot path changed, and `resolveArizeConfig()` returns null without
`ARIZE_*`, so an unconfigured deployment constructs no provider and exports nothing.

**The project took its first added runtime dependencies** (four OpenTelemetry packages plus the
OpenInference conventions). That ends a stated position, and NOTICES now records it with
licences and rationale rather than leaving the old claim to rot.

**Two more surfaces now hold customer content** — the handoff artifacts and, when configured,
the Arize export, which sends it to a third party. Both are recorded under SEC-03, which was
widened in the same pass. QA's position: the artifacts inherit the scrubber, the gitignore and
the retention sweep, so they add copies rather than a new class of exposure; the Arize export is
a *data-sharing decision*, and the right control is that it is off unless two variables are set.

## AC-TRACE-01 — now arguably closeable, deliberately left Partial

The criterion has been Partial because per-hop latency was "not captured or displayed". Arize
now displays exactly that (`returns-advisor — 7190ms`). QA is **not** closing it, for two
reasons: the criterion names the operator trace panel, and the panel still does not show it; and
a criterion satisfied only when an optional third-party export is configured is not satisfied by
the build. Recorded so the next pass does not have to re-derive the argument.

## Defects

**DEF-09 found and fixed in this pass.** No other defect opened. The register below is updated.

---

# Re-test — 2026-09-04

## Verdict

**153 / 153 unit · 114 / 114 eval · 7 / 7 smoke.** No defect opened. Every check that passed on
2026-08-29 still passes on a build that has since changed the trace layer.

This pass exists because `@backend.eng` modified `redact()` and added turn-level timing, and two
recorded QA claims rested on the code that changed: **AC-TRACE-03** ("no secret in the trace
payload") and the Audit's unit count. A criterion whose evidence predates the change is not
evidence. Both were re-verified rather than assumed.

The pass also produces the project's **first measurement of turn latency**, which QA-OQ-5 has
been asking for since 2026-08-29. The number is not comfortable.

## Unit (`*test-unit`)

`npm test` — **153 tests, 153 pass, 0 fail, 8.0 s.** Up from 143; the ten new tests are
`server/runtime/trace.test.ts`, authored by `@backend.eng` alongside the redaction change.

QA's interest in that file is narrow and specific: it is the only thing standing behind
AC-TRACE-03 now that the redaction rule is looser than the rule QA signed off on. It pins both
directions — usage counts survive, credentials do not — which is the right shape, because a
regression either way is silent on disk.

## Integration (`*test-integration`)

`npm run eval:sdk` re-run in full against a live server (`CHAT_ENGINE=sdk`,
`AS_OF_DATE=2026-09-01`): **114 / 114 across all 9 scripts.** Unchanged from 2026-08-29 — same
assertions, same result, on a build eleven commits later. Slice G still holds `hops === 1`, and
every slice still asserts zero money tools invoked at runtime.

Run cost **$1.76** across 9 slices, measured rather than estimated (see Latency and cost below).

## Smoke (`*qa`)

Deterministic engine, keyless, `AS_OF_DATE=2026-09-01`. All seven cases match their recorded
expectations exactly.

| # | Case | Result |
|---|---|---|
| S1 | `GET /api/health` | `ok` · duckdb `ok` · stores `ok` · engine `deterministic` |
| S2 | WISMO, order 46101 | `resolved` — "Placed 2026-09-01 (today)" |
| S3 | Refund request | `escalated`, ticket `STUB-F914502D`, `payment_or_refund` |
| S4 | Unknown order 99999999 | `needs_input`, no invented tracking |
| S5 | No identity supplied | `needs_input` |
| S6 | Malformed JSON body | `400` |
| S7 | Missing `message` | `400` |

## AC-TRACE-03 re-verified after the redaction change

The change widens what survives `redact()`: `*_tokens` counts (and their camelCase form) are no
longer treated as secrets, because matching the substring "token" had been writing the entire
usage block to disk as `[REDACTED]`.

Verified against a synthetic `prompt_trace` record carrying a provider key in four shapes — as
an env var, as an `authorization` header, as `access_token`, and embedded mid-sentence inside
`systemPrompt`. **All four redacted; usage counts and budgets preserved; the key appears
nowhere in the output.** Separately, the real `ANTHROPIC_API_KEY` from `.env.local` does not
appear in any file under `project-context/2.build/logs/`.

**AC-TRACE-03 stands.** The narrower reading QA should carry forward: the guarantee now rests on
a value-type rule (credentials are strings, usage is numbers) rather than on a key-name rule
alone. A secret that is a *number* would pass — not a real shape for a credential, but the
assumption is now load-bearing and worth naming.

## Latency and cost — the first measurement (`*qa`)

`npm run observability` reads the JSONL traces the runtime already writes. Across the project's
whole history — **353 turns, 332 conversations**:

| Metric | Value | Against |
|---|---|---|
| Error rate | **0.6%** (2/353 turns) | no target stated |
| Turn latency p50 | **16.0 s** | — |
| Turn latency **p95** | **30.4 s** | **PRD target: p95 < 30 s** |
| Turn latency max | 63.1 s | — |
| Total spend | $53.21 over 353 turns | — |

**The p95 target is missed, at single-user load, before any concurrency is applied.** 30.4 s
against a < 30 s target is marginal rather than catastrophic, and today's 12-turn window came in
at 27.8 s on a warm cache — but the honest reading is that the target is at the edge and the
≥ 5-concurrent half of it has still never been exercised.

Two structural facts the measurement settles, both of which narrow where any fix could come
from:

1. **The data layer is not the cost.** Every DuckDB tool answers in under 25 ms (`get_order`
   p95 11 ms). The `Agent` delegation hop is p50 6.8 s, p95 14.8 s. No query optimisation moves
   the number; only hop count or model configuration will.
2. **A second hop roughly doubles the wall clock.** `order-specialist` alone runs p95 28.6 s;
   `order-specialist → escalation-handoff` runs p95 53.8 s. This is direct evidence for the SAD
   chain exception that lets `returns-advisor` read order *and* policy itself — the design
   choice is visible in the latency data, not just in the hop count slice G asserts.

Spend is dominated by cached prompt handling (75.8% cache hit ratio on cacheable input), not by
the customer's question — so cost scales with conversation setup, not with question complexity.

## AC-TRACE-01 — closer, still partial

Future work item 3 called for per-hop latency. What now exists is **turn-level** `durationMs`
(on both `turn_result` and `turn_error`) and **per-tool** `durationMs`. Per-*hop* timing is
derivable offline from the `agent_hop` → `agent_stop` timestamps but is still neither captured
as a field nor displayed in the trace panel, which is what the criterion asks for.

**AC-TRACE-01 remains Partial.** Recorded precisely so the next pass does not inherit a
half-closed criterion as a closed one.

## DEF-08 regression coverage — checked, and better than the register implied

DEF-08 is marked Fixed with future-work item 2 still open ("a pleasantry eval slice, so DEF-08
cannot regress"). That reads as an unguarded fix. It is not:
`server/runtime/groundingGuard.test.ts` covers all four failing sign-offs from the defect table
plus five more, and — the part that matters — the negative cases that make the fix falsifiable:
`"thanks, but where is my refund"`, `"ok bye, cancel my membership"` and `"Is that all?"` must
NOT be treated as sign-offs.

The guard is a pure function, so unit coverage is the strong form of this test and an eval slice
would add live confirmation rather than new information. **Future work item 2 is downgraded from
a coverage gap to a nice-to-have**, with the reason recorded.

## Defects

**None found.** No check in this pass failed, and the defect register is unchanged: every DEF-*
and INT-* item remains closed.

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

**46 covered · 5 partial · 1 not covered · 3 by-absence/out-of-scope.** *(Updated 2026-08-29
after `@backend.eng` closed the device/app-version gap — was 43 / 5 / 4.)*

| AC | Verified by | Status |
|---|---|---|
| AC-CHAT-01 | Browser: page loads, send/receive | Pass |
| AC-CHAT-02 | Token frames observed streaming, both engines; `lib/fsm.test.ts` | Pass |
| AC-CHAT-03 | Trace panel gated; no raw tool JSON in customer text; `lib/status.test.ts` | Pass |
| AC-CHAT-04 | `globals.css` `color-scheme: light dark` = `theme: system`; minimal chrome | Pass |
| AC-CHAT-05 | "Talk to a human" → ticket `STUB-E0420689`, `customer_requested_human` | Pass |
| AC-TRIAGE-01 | Intent routing observed across 8 eval scripts + 18 integration cases | Pass |
| AC-TRIAGE-02 | Missing id → one clarifying question → `needs_input` (S5); `needsInput.test.ts` | Pass |
| AC-TRIAGE-03 | `escalationContext.test.ts` + eval slice I; runtime-derived, both engines | **Pass 2026-08-29** |
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
| AC-ESC-05 | Full normative intent→category map in code; `escalationContext.test.ts` | **Pass 2026-08-29** |
| AC-TICKET-01 | Session-persisted across turns + in the stub; `session.test.ts`, eval slice I | **Pass 2026-08-29** |
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

### The gap that closed, and what remains

**AC-TRIAGE-03 / AC-TICKET-01 / AC-ESC-05 — closed 2026-08-29.** They were one gap wearing
three hats: the schema accepted `device` and `app_version`, the corpus documented the Android
3.2.0 case, `create_ticket_stub` would store both — and no prompt asked any agent to capture
them, so an app-crash ticket reached a human without the two fields an engineer needs first.

`@backend.eng` closed it as a **runtime derivation rather than a prompt line**, which is the
right call and the one this project keeps having to relearn: the customer already wrote
"Android 3.2.0", the runtime already has those words, and asking a model to re-type them adds
a way to get them wrong. Verified live — and the first version of the fix let the model's
re-typed value win, which was caught by observing `"Android"` where the extractor had
`"android"`. Harmless in that instance, and the same precedence would have let a
mis-remembered version through.

AC-ESC-05 turned out to be larger than the ADR-13 corner: the PRD writes out a **full
normative intent→category map**, and the deterministic engine had been sending a hand-picked
`"billing"` where the map says `payment_issue`. The whole map is now in code.

**Still partial or open:**

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
| DEF-07 | Explicit operator budget silently replaced by the default | Low | **Fixed 2026-08-29** | — |
| DEF-08 | Tickets opened for pleasantries — 4 of 8 sign-offs | Medium | **Fixed 2026-08-29** | — |
| INT-03 | Clarifying question reported `resolved`, with a CSAT card | Medium | **Fixed 2026-08-29** | — |
| DEF-09 | Returns eligibility ignored item category — an in-window order with an excluded item was told yes | Medium | **Fixed 2026-09-04** | — |
| DEF-10 | Over-escalation on in-window returns — DEF-09's fix made the specialist hand off when it could not settle the category half; measured 2 in 5 | Medium | **Fixed 2026-09-04**, re-measured 5/5 | — |
| DEF-11 | Processing-calendar answer inconsistent on returned orders — escalated 2 in 4, quoted the 3–5 day policy 1 in 4 | Low | **Fixed 2026-09-04**, re-measured 4 in 5 quoting the window, 1 in 5 escalating — residual split out as DEF-14 | — |
| DEF-12 | Client `buildChatRequest()` hard-required `orderId`, so a membership or order-history question never left the browser | Medium | **Fixed 2026-09-04** | — |
| DEF-13 | A coordinator answer grounded in conversation memory was force-escalated as `ungrounded`, opening a duplicate ticket with refund boilerplate | Medium | **Fixed 2026-09-04**, verified 2/2 on all three faults | — |
| DEF-14 | A correct policy retrieval is rejected by the 0.55 grounding gate when the agent's query mixes in a term from an adjacent section | Low | **OPEN — accepted**, deterministic repro below | `@backend.eng` + `@system.arch` (ADR-11) |

**DEF-07, DEF-08 and INT-03 were all fixed the same day by `@backend.eng`.** No defect in any
pass has been a safety defect — the zero-money-tools boundary held under every check.

**DEF-11 is closed, and closing it produced DEF-14.** The prompt had been telling the returns
specialist that the holiday calendar was "the honest part of an answer you otherwise cannot put a
date on" — but the corpus *does* answer processing time, in `data/policy/returns.md` under "Return
processing times". The specialist was obeying an instruction to withhold something written down.
That is DEF-10's mistake in a second place: an answerable half withheld because an adjacent half is
uncertain. The fix splits the question in the prompt — the processing *window* is written policy
and must be quoted with its citation; when the *money* lands is a human's, always. The calendar
became context that qualifies the window rather than a substitute for it.

Re-sampled 2026-09-04 against the **production build**, five turns on the DEF-11 path and ten more
across every other returns path DEF-10 showed a prompt change here can break:

| Path | Turns | Result |
|---|---|---|
| 45538 "how long until it is processed" (DEF-11) | 5 | **4 resolved / 1 escalated**; window quoted **4 in 5**; `search_policy` 5/5; calendar 4/5 |
| 42776 "can I still return this" (DEF-10) | 4 | **4/4 resolved**, eligibility answered 4/4 — no regression |
| 44279 "can I still return this" (DEF-09) | 3 | **3/3 resolved** with the excluded-item caveat intact 3/3 — no regression |
| 44279 "return just the shampoo" (ret-05) | 3 | **3/3 resolved**, `get_order_items` 3/3 |

**No invented timeline and no money tool in any of the 15 turns.** Was 2-in-4 escalating and 1-in-4
quoting the policy; is now 1-in-5 escalating and 4-in-5 quoting it.

**A note on how this was graded, because it nearly went the other way.** The first grader read the
tool ledger with bare names (`get_processing_calendar`) while the trace writes them namespaced
(`mcp__novamart__get_processing_calendar`), and so reported **0 in 5** tool calls on every path —
a clean, plausible, entirely false "the agent stopped calling its tools". Re-graded from the trace
files. This is the third time in this project that a check has failed for a reason belonging to
the check rather than the product (DEF-06, the two wording-assertion eval slices, now this), and
the pattern is the same each time: an assertion on a *representation* rather than on a contract.

### DEF-14 — a correct retrieval rejected by the grounding gate. Low, open.

The one escalation in five is not the specialist disobeying. Its reply says *"I don't have a
verified processing-time window to give you from our policy data"* — which was **true**, and the
trace says why. All five turns called `search_policy`; the four that answered used a short query,
and the one that escalated searched:

| Query the agent wrote | Top-1 chunk | Score | Gate |
|---|---|---|---|
| `return processing time window` | `policy:returns#return-processing-times` | **0.7156** | grounded |
| `return processing time timeline` | `policy:returns#return-processing-times` | **1.0000** | grounded |
| `return processing time refund window after receiving returned item` | `policy:returns#return-processing-times` | **0.4697** | **rejected** |

**The ranking was right every time.** The same correct section ranks first in all three, including
the rejected one — only the score moves. `policyScore.ts` already caps scoring at the four
highest-idf query terms precisely because sentence-shaped queries dilute coverage, but that cap
cuts both ways: with only four terms carrying the judgement, one high-idf term from an adjacent
section (`refund`, which belongs to `policy:returns#refunds`) costs roughly a quarter of the
denominator and drops a correct retrieval under the 0.55 gate.

Reproducible with no model in the loop — `searchPolicy()` alone, same three queries, same scores.
That makes it a **retrieval defect, not a prompt defect**, and it is why DEF-11 was closed rather
than left open against the specialist: no further prompt wording fixes this.

**Accepted for this release.** It fails cautiously — the customer reaches a human, and nothing
wrong is said. **Not fixed here** because the candidate fixes all touch ADR-11's normative
threshold or the scoring function under it, which is `@system.arch` territory and needs the
grounding tests re-run against the whole corpus, not a returns path. Recorded with the repro so
whoever takes it starts from evidence rather than from a rate. The obvious candidates, none
chosen: retry once with the top-idf terms only; or let rank rather than absolute score carry the
decision when top-1 is unambiguous. **Tuning 0.55 is not a candidate** — that number is normative
and the file says so.

The prediction that DEF-08 and INT-03 shared a root was **half right**, and the half that was
wrong is the more interesting one. Both are the runtime deciding terminal status on incomplete
information, but they needed separate fixes: DEF-08 was a matching-granularity problem (phrase
vs word), while INT-03 turned out to rest on a runtime signal that did not exist — a tool that
returns an error never reaches `PostToolUse`, so a failed lookup was invisible in the outcome
ledger the fix was first written against. See `backend.md` for what that cost.

## Future work

Non-MVP tests and coverage, for the backlog.

1. ~~**Close the three-hat gap**~~ **Done 2026-08-29** — runtime-derived `device` /
   `app_version`, session-persisted, plus the full AC-ESC-05 category map and eval slice I.
2. ~~**A pleasantry eval slice**, so DEF-08 cannot regress once fixed~~ **Downgraded
   2026-09-04** — `groundingGuard.test.ts` already covers all four failing sign-offs plus the
   negative cases that make the fix falsifiable. The guard is a pure function, so unit coverage
   is the strong form; a live slice would confirm rather than inform.
3. **Per-hop latency** in the trace, closing AC-TRACE-01, and `alignMaxDateToToday` in the
   panel, closing AC-TIME-05. **Partially advanced 2026-09-04**: turn-level and per-tool
   `durationMs` now exist and `npm run observability` reports them, but per-*hop* timing is
   still not captured as a field or displayed in the panel, which is what the criterion asks
   for. AC-TRACE-01 stays Partial.
4. **Citation precision**: assert that returned citations are relevant to the question, not
   merely present.
4b. **A returns slice with an excluded item**, so DEF-09 cannot regress. Order 44279 (in-window,
   contains a supplement) is the fixture. The existing slice G uses an order with no excluded
   item, so it passes either way — which is exactly why DEF-09 survived a green eval suite.
5. **A second eval profile** for budget-constrained runs (`MAX_HOPS=1`), so the forced-escalation
   path has live coverage as well as unit coverage. Blocked today because the harness assumes
   one server process.
6. **Component tests for the React surfaces.** `fsm.ts`, `status.ts` and `text.ts` are covered;
   `TracePanel` and `CsatPrompt` are verified only by browser driving. A component harness
   would need a test renderer — the first genuine test dependency this project would take on,
   so it needs a deliberate decision rather than a default yes.
7. **Load**: PRD targets ≥ 5 concurrent chats and turn p95 < 30 s. **Half-measured, and the
   measured half now passes.** Turn p95 is **28.2 s over 514 turns** against a < 30 s target, at
   single-user load with no concurrency applied — it was 30.4 s over 353 turns, so the number
   moved as the sample grew rather than because anything was optimised, and it sits close enough
   to the line that a slower model or a longer prompt puts it back over. The ≥ 5-concurrent half
   is still unexercised; nothing here has run more than one turn at a time. Since latency is
   dominated by the model hop and not the data layer (tool p95 ≤ 12 ms), concurrency is likely to
   erode this rather than reveal headroom.
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
| QA-OQ-5 | ~~Nothing has measured the PRD's ≥5-concurrent-chats and p95 < 30 s targets.~~ **Partially answered 2026-09-04**: p95 is measured at **30.4 s against a < 30 s target** — the evidence now exists and is unfavourable. Concurrency remains unmeasured. Open question is no longer "is there evidence" but "does a marginally-missed p95 need fixing, scoping, or stating plainly before the demo?" | Operator |

## Audit

| Field | Value |
| ----- | ----- |
| Persona | `@qa.eng` |
| Actions | `*test-unit`, `*test-integration`, `*qa`, `*verify-flow`, `*log-defects`, `*future-work` |
| Timestamp | 2026-08-25 (Sprint 1); 2026-08-28 (Sprint 2 re-test); 2026-08-29 (full pass); 2026-09-04 (re-test + first latency measurement); 2026-09-04 (demo-readiness pass); **2026-09-04 (release pass — DEF-11/DEF-13 verification)** |
| Commit under test | `09e8184` (2026-08-29); `f0bbcc2` (2026-09-04); `62e7970` (2026-09-04, demo-readiness); **`d765978` + the DEF-11 prompt change (2026-09-04, release pass)** |
| Resolved runtime | `AAMAD_TARGET_RUNTIME=claude-agent-sdk` (env, matches `aamad.config.yml`) |
| Model at verification | `claude-sonnet-5`, `effort: low`, `SDK_STREAM_MODE=live` |
| Unit | **169 / 169**, Node built-in runner, still no test-framework dependency (143 → 153 → 160 → 169) |
| Eval | **114 / 114** across 9 scripts plus **26 / 26** on the golden dataset (`npm run evals`, both SAFETY categories 100%), `AS_OF_DATE=2026-09-01` — both re-run 2026-09-04 after the DEF-11 prompt change; slice G's `hops === 1` held |
| Smoke | **8 / 8** on the keyless engine — S8 added for the handoff artifacts |
| Flow | Verified in a browser end to end, both engines, plus mock mode |
| AC coverage | 55 criteria mapped: **46 pass, 5 partial, 1 not covered**, 3 by-absence/out-of-scope |
| Dependencies | **Changed 2026-09-04.** The project took its first added runtime dependencies (4 × OpenTelemetry + OpenInference conventions) for Arize export. Recorded in NOTICES with licences. Still no test-framework dependency |
| Performance | Turn p95 **28.2 s over 514 turns** vs PRD < 30 s — **now met at single-user load** (was 30.4 s over 353); error rate **0.0%**. Concurrency still unmeasured, and that half of NFR-PERF-02 is what the target was really about. Cost figures are the SDK's computed `total_cost_usd` (tokens × list price) — a usage estimate, **not** a statement of what was billed |
| Defects open | **One, accepted — DEF-14**, a retrieval defect found by fixing DEF-11 and split out from it. DEF-07/08/INT-03 closed 2026-08-29; DEF-09, DEF-10, **DEF-11, DEF-12 and DEF-13 all fixed 2026-09-04**. DEF-14 fails cautiously (customer reaches a human, nothing wrong is said) and its fix touches ADR-11's normative threshold, so it is `@system.arch`'s call, not a QA one |
| Files written by `@qa.eng` | 2026-08-29: `dateShift.test.ts`, `hooks.test.ts`, `eval-sdk.mjs`, `test-resolver.mjs`, `package.json`. 2026-09-04 (all three passes): **this file only**. **`@qa.eng` has modified no application logic in any pass** — DEF-09's, DEF-11's and DEF-13's fixes were all `@backend.eng`'s |
| Security handoff | `security.md` exists with no Critical findings; `@security.eng` ran before Deliver as `aamad.config.yml` requires |
| Self-check | Required sections present: Sources, Assumptions, Open Questions, Audit. No Diagnostic raised |
