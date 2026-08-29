# Backend Epic — NovaMart Support MVP

Runtime: **`claude-agent-sdk`**. Authority for scope: `project-context/1.define/sad.md`
(§2 crew spec, §4 API + data, Sprint 1 slice) and `prd.md` §3.2.

## The one thing to know first

There are **two turn engines behind one wire contract**, and the keyless one is the default.

| | `deterministic` (DEFAULT) | `sdk` (opt-in) |
|---|---|---|
| Selected by | `CHAT_ENGINE` unset / anything but `sdk` | `CHAT_ENGINE=sdk` |
| Needs a key | No | `ANTHROPIC_API_KEY` + `MODEL_ID` |
| Reply source | composed in code from the tool result | claude-agent-sdk crew |
| Network / subprocess | none | Anthropic API via the SDK |
| Status | working, verified below | scaffolded, **never executed** — no key in this environment |

The deterministic engine is the Sprint 1 vertical slice **ported verbatim** out of
`app/api/chat/route.ts` (commit `65104f8`) into `server/runtime/engines/deterministic.ts`.
Not rewritten, not "improved" — same tokens, same order, same citation ids, same statuses.
It is what the demo and the F-EVAL-01 scripts run on, and it must stay the default.

`packages/shared/src/dto.ts` was not touched. Neither were `app/page.tsx`,
`lib/chatClient.ts`, `lib/services/turnService.ts` or `lib/services/mockStream.ts` — the
frozen `ChatRequest` / `StreamEvent` shapes are identical, so the frontend needed zero edits.

## Architecture

```text
POST /api/chat  (app/api/chat/route.ts)
  parse → validate ChatRequest → resolveTemporalMeta() → pick engine → pump SSE
      │
      │  server/runtime/engine.ts  ── TurnEngine { id, runTurn(input, emit) }
      │
      ├── engines/deterministic.ts   DuckDB read → DateShiftMapper → sentence in code
      └── engines/sdk.ts             (dynamic import)
              ├── agents.ts        coordinator prompt + AgentDefinitions
              ├── tools.ts         in-process MCP server (read-only, 4 tools)
              ├── hooks.ts         hop accounting · allowlist denial · trace frames
              ├── escalation.ts    package validator + in-memory TicketStubStore
              ├── toolRegistry.ts  the zero-money-tools invariant (no imports)
              └── trace.ts         Prompt Trace + JSONL lifecycle log
```

The route handler now does four things only: parse/validate, resolve temporal context, select
an engine, and pump frames. Everything that decides *what to say* is behind `TurnEngine`.

`engines/select.ts` reaches the sdk engine through a **dynamic `import()`**. On the default
path the claude-agent-sdk module graph is never evaluated — no CLI subprocess is located, no
key is read, no network stack is touched. A broken sdk engine cannot take the demo down.

### Files

| File | Role |
|------|------|
| `app/api/chat/route.ts` | SSE endpoint: validate, temporal, engine select, pump, cancellation |
| `app/api/health/route.ts` | `GET /api/health` — SAD §4 shape + resolved engine |
| `server/runtime/engine.ts` | `TurnEngine`, `TurnInput`, `AgentTemporalView`, shared tokenizer |
| `server/runtime/config.ts` | engine selection + every execution budget, resolved explicitly |
| `server/runtime/engines/deterministic.ts` | Sprint 1 slice, ported verbatim |
| `server/runtime/engines/sdk.ts` | claude-agent-sdk turn: preflight → query → single-voice stream |
| `server/runtime/engines/select.ts` | dynamic loader; keeps the SDK off the default path |
| `server/runtime/agents.ts` | coordinator prompt + registered `AgentDefinition`s |
| `server/runtime/tools.ts` | in-process MCP server; shift applied here |
| `server/runtime/toolRegistry.ts` | tool-name truth + money-tool assertions (zero imports) |
| `server/runtime/toolRegistry.test.ts` | exact-set invariant test (`npm run test:invariants`) |
| `server/runtime/hooks.ts` | PreToolUse / PostToolUse / SubagentStart / SubagentStop |
| `server/runtime/escalation.ts` | `EscalationPackage` validator + in-memory stub store |
| `server/runtime/trace.ts` | redacted Prompt Trace + JSONL under `2.build/logs/` |
| `server/runtime/stubs.ts` | inert Sprint 2 / non-MVP surface |

## Agent roster (`*define-agents`)

Main agent = coordinator (`triage-router`). Specialists are `AgentDefinition` entries in
`ClaudeAgentOptions.agents`, invoked via the `Agent` tool (SAD §2 Runtime roles).

| Agent | Registered? | Tools granted | Can delegate? |
|-------|-------------|---------------|---------------|
| `triage-router` (main) | yes | `Agent` only | yes — the only one |
| `order-specialist` | yes | `get_order`, `get_order_items`, `list_orders_for_user`, `get_processing_calendar` | **no** |
| `faq-policy` | yes | `search_policy` | **no** |
| `plus-specialist` | yes | `get_membership`, `get_user`, `search_policy` | **no** |
| `returns-advisor` | yes | `get_order`, `get_order_items`, `get_processing_calendar`, `search_policy` | **no** |
| `escalation-handoff` | yes | `create_ticket_stub`, `format_handoff_summary` | **no** |

All six are registered as of Sprint 2 (tool names above are shown bare; the model sees them
`mcp__novamart__`-prefixed). The rule that got them here is unchanged and still binding: **an
agent is registered in the same change that registers its tools, never before.** Sprint 1 ran
three agents because `search_policy` and `get_membership` did not exist yet, and an agent
without tools has exactly one way to answer — from model memory — which is the "escalate over
invent" failure the PRD forbids.

Two allowlist decisions carry design weight:

- **`returns-advisor` holds BOTH the order tools and the policy tool.** That is the SAD §2
  chain exception in code: return eligibility is order dates measured against written policy,
  so splitting it across two specialists would cost a second hop and produce a worse answer —
  `order-specialist` cannot read the returns policy, and `faq-policy` cannot read the order.
  Slice G of the eval asserts `hops === 1` for exactly this reason.
- **`faq-policy` holds no order tools at all.** A policy question answered with somebody's
  order data is a privacy problem; an order question answered from policy prose is an
  ungrounded one.

**Delegation is structural.** Specialists do not receive the `Agent` tool in `tools`, and
`disallowedTools` names it (and every built-in) explicitly. A specialist cannot spawn another
specialist even under prompt injection, because the capability is absent — not because the
prompt asks it not to. `PreToolUse` denies it a third time if it somehow appears.

## Tools

Nine tools — the complete SAD §2 MVP tool contract — all read-only or ticket-writing, served
from an **in-process MCP server** (ADR-07 — no external MCP server in MVP):

| Tool | Reads | Side effect |
|------|-------|-------------|
| `get_order` | DuckDB `orders`, RO | none |
| `get_order_items` | DuckDB `order_items` + `products`, RO | none |
| `list_orders_for_user` | DuckDB `orders`, RO, newest first, `limit ≤ 5` | none |
| `get_user` | DuckDB `users`, RO | none |
| `get_membership` | DemoOverlay, then DuckDB `memberships`, RO | none |
| `search_policy` | `data/policy/*.md` via the section scorer | none |
| `get_processing_calendar` | DuckDB `orders` + `users.country`, RO, then Nager.Date over HTTPS | none |
| `create_ticket_stub` | — | writes an in-memory ticket stub (never the practice DB) |
| `format_handoff_summary` | in-memory stub | none |

`get_membership` computes `active_as_of_today` and `days_remaining` **in code** rather than
returning two dates for the model to compare. Date arithmetic in prose is a reliable source
of confident wrong answers, and "is my trial still running" is the question the whole Plus
path exists to answer.

### `search_policy` and the 0.55 gate (ADR-11 / AC-FAQ-01)

The corpus is four markdown files chunked by `##` section. Scoring is inverse-document-
frequency coverage of the query's most informative terms, weighted higher for a match in the
section heading than in its body. `server/data/policyScore.ts` has no imports so the gate is
unit-testable; `server/data/policy.ts` does the file I/O.

**Below the threshold, the tool returns no policy text at all** — not the text with a warning
attached. An agent cannot answer from a weak hit it was never shown, which makes "escalate
over invent" a property of the tool rather than a request made of the model. AC-FAQ-03 falls
straight out of that: a question the corpus cannot answer produces `grounded: false`, and the
coordinator escalates with `reason_code=ungrounded`.

Three retrieval defects were found by running real turns, and all three are regression-tested:

1. **The document title counted as a heading match.** Every section of `returns.md` inherited
   "returns" from the `#` title, so a one-word query scored a perfect 1.00 on six sections at
   once and ranking fell back to alphabetical order. Titles are body-weighted now.
2. **The stemmer did not actually collide inflections.** `received` → `receiv` but `receives`
   → `receive`; `processing` → `proces` but `process` → `process`. Live turns escalated
   questions the corpus answers word for word, because the words never met. The test asserts
   the collisions, not the stems — the output string is an implementation detail.
3. **Sentence-shaped queries diluted the score.** An agent writes "return processing timeline
   after item received", not "return processing". Trailing words that exist elsewhere in the
   corpus dragged correct retrievals under the gate (0.504 and 0.5264 were both measured on
   the right section). The fix is ordinary term selection — the four highest-idf terms carry
   the judgement. **The threshold itself was not moved**: it is normative, and an eval check
   asserts it is still 0.55 in the trace.

### The one external integration

`get_processing_calendar` is the only tool in this system that leaves the process for
anything other than the Anthropic API. It names upcoming public holidays in the customer's own
country so an answer about a **return** can say *why* processing might run slow — context,
never a promised date. Carrier tracking was the obvious alternative and was rejected: `orders`
has no tracking number and no in-transit rows, so a tracking integration would have meant
inventing shipments. `users.country` is real fixture data.

It shipped once as `get_delivery_calendar` and was **unreachable**, which unit tests could not
have caught. Every order in the fixture is terminal — 40,234 `completed`, 4,596 `cancelled`,
2,369 `returned` — so a gate keyed on "not yet delivered" matched nothing. That is the same
absence that ruled out tracking, and it applied to a delivery calendar too. Repointing it at
the 2,369 real `returned` orders gave it a question the data supports. Two further constraints
surfaced only under the live eval:

- **Refund wording never reaches a specialist.** The coordinator routes any refund ask
  straight to a human, by design. So the tool answers return *status*, not refund *timing*.
- **An optional gate is a coin flip.** `MAY call` fired on roughly half of eligible turns at
  `effort: low`. The gate is now `ALWAYS`, and `eval:sdk` Slice C asserts the invocation.

Four properties make an outbound dependency safe to put behind a support agent
(`server/data/holidays.ts`):

1. **It never throws.** Every failure — timeout, 5xx, unreachable host, malformed body —
   resolves to `calendar_available: false` with a named reason. The turn still answers from
   DuckDB. A third party being down degrades an answer; it must never break one.
2. **No SSRF surface.** The host comes from `HOLIDAY_API_BASE_URL`, an operator setting. Only
   the year and a validated two-letter country code are interpolated into the path. Nothing
   model-supplied or customer-supplied reaches the URL.
3. **Bounded.** Explicit `AbortSignal` timeout (`HOLIDAY_TIMEOUT_MS`, default 3s); no implicit
   default is relied on.
4. **Cached.** Holidays change at most yearly, so `{country}:{year}` is cached for the life of
   the process.

The fixture stores `UK`, which is not an ISO 3166-1 alpha-2 code — Nager.Date wants `GB`.
`normalizeCountryCode` maps it, and the `other` bucket resolves to "country unknown" rather
than a bogus lookup. Without that mapping ~12% of users would have degraded silently, which
is the worst kind of bug in a system whose failure mode is designed to look ordinary.

Upstream also lists one holiday twice when it has both a regional and a national variant — a
live US lookup returns Columbus Day as `global:false` and `global:true`. `upcomingFrom`
collapses same-date-same-name to the nationwide entry, because telling a customer about one
holiday twice reads as a bug.

The upstream call is mocked in `server/data/holidays.test.ts` (20 cases, most of them failure
paths), so CI never touches the network. Slice C of `npm run eval:sdk` covers the live path.

`get_user`, `list_orders_for_user`, `get_membership` and `search_policy` are in the SAD tool
contract but are **not registered** — stubbed in `stubs.ts`, throwing `notImplemented()`.

## The zero-money-tools invariant

> Sprint 1 exit criterion: *zero money tools registered in the process.* NFR-SAFE-01.

Enforced at **five independent layers**, none of which is a prompt instruction:

1. **Nothing bound.** No refund, cancel, payment, or billing function exists anywhere in this
   process. There is nothing to call. Every other layer is insurance against a future edit.
2. **Startup assertion.** `assertNoMoneyTools()` + `assertRegisteredSetMatches()` run inside
   `createNovamartToolServer()`, *before* a single `AgentDefinition` exists. A money tool, or
   any drift from the reviewed set, **throws** — the sdk engine fails to boot rather than
   running degraded. `MONEY_TOOL_PATTERNS` is a deliberately broad substring list (`refund`,
   `cancel`, `charge`, `payment`, `billing`, `card`, `capture`, `payout`, …): a false positive
   costs a build error you fix in seconds, a false negative charges a customer's card.
3. **Exact-set unit test.** `npm run test:invariants` asserts the registered set *equals* a
   hard-coded literal, that no agent allowlist grants a money tool, that only the coordinator
   holds the delegation tool, and that no agent holds a shell / write / network built-in.
   Adding a tool fails this test even if its name looks innocent.
4. **PreToolUse denial.** The hook denies (a) any money-vocabulary tool name, (b) any tool
   outside the calling agent's allowlist, (c) delegation by a non-coordinator, (d) delegation
   past the hop budget.
5. **`canUseTool` permission gate.** A second, independent runtime callback on the query that
   denies money-vocabulary tools without consulting the hook table.

Layers 2–5 all read from `server/runtime/toolRegistry.ts`, which has **zero imports** so the
invariant test can load it under `node --test` without Next, DuckDB, or the SDK.

## Execution controls

Every budget is resolved to a concrete number in `config.ts`. Nothing falls through to an SDK
default (adapter Execution).

| Control | Default | Env | Source |
|---------|---------|-----|--------|
| `maxHops` | 4 | `MAX_HOPS` | SAD §2 / ADR-08 |
| `maxModelTurns` | 12 | `MAX_MODEL_TURNS` | caps tool ping-pong inside one hop |
| `turnTimeoutMs` | 60000 | `TURN_TIMEOUT_MS` | SAD §2 |
| `maxOutputTokens` | 4096 | `MAX_OUTPUT_TOKENS` | via `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |
| `effort` | `low` | `MODEL_EFFORT` | SDK `effort`; replaces temperature as the determinism lever |
| `thinkingBudgetTokens` | unset ⇒ adaptive | `MAX_THINKING_TOKENS` | SDK `thinking`; fixed budget is for OLDER models only |
| `toolReadRetries` | 1 | `TOOL_READ_RETRIES` | SAD §2 Retries |

**Hop accounting** follows SAD "Hop accounting (normative)" exactly: a hop is an *agent
transfer*, not a tool call. `hops` increments in the `SubagentStart` hook and nowhere else,
so no number of tool calls inside one agent can consume budget. The budget is checked
*before* a handoff in `PreToolUse`; when spent, delegation is denied with an instruction to
escalate — except delegation to `escalation-handoff`, which is exempt because it is the
terminal state and a hop-exhausted turn would otherwise have no legal exit.

**Cancellation.** The route builds one `AbortController` per turn, aborted by client
disconnect (`request.signal`) or the turn timeout. It is forwarded to the SDK query and
checked between tool retries. An aborted turn emits a safe message and writes no partial
ticket stub.

**Idempotency.** `create_ticket_stub` is idempotent on `conversationId + reason_code`: a
replayed turn returns the existing ticket id instead of opening a second ticket. Repository
reads are side-effect free, which is what makes the single retry safe.

## Temporal safety

The model is handed `{ asOf }` and nothing else — that is the entire `AgentTemporalView`
type. `shiftDays`, `alignMaxDateToToday` and `overlayHit` are **not in the type**, are not in
any prompt, and never enter the tool context. An agent that could read `shiftDays` could
subtract it back off and reason about the real 2024 dataset, which is exactly what the
temporal layer exists to prevent.

The shift is applied inside `tools.ts` (and inside the deterministic engine) at the
repository boundary. `TemporalMeta` in full is operator-only: response headers
(`X-Novamart-*`) and the Prompt Trace log.

## Single voice

The customer hears one assistant. Three mechanisms, all structural:

1. `forwardSubagentText: false` on the query — specialist text never reaches the turn loop.
2. A hard `parent_tool_use_id === null` filter on every message the loop reads, so anything
   that did arrive from a subagent is dropped before it could become a `token` frame.
3. `SDK_STREAM_MODE` (default **`final`**) buffers the coordinator's text and emits it once
   the turn resolves, so mid-turn reasoning cannot leak ahead of the answer. `live` streams
   main-agent deltas for lower TTFT and should only be enabled once the coordinator is
   verified to speak exactly once, at the end.

`agent_hop` and `tool_call` frames are gated on `clientFlags.trace` in one place
(`emitTrace` in the sdk engine; the `trace` branch in the deterministic engine), per SAD §4
"omit if !trace".

## Observability

`server/runtime/trace.ts` writes one JSONL file per conversation under
`project-context/2.build/logs/`. **Prompt Trace is captured before execution**: model,
`effort`, the resolved `thinking` config, every resolved budget, the rendered system and user prompts, each agent's tool
list, the global allowlist, and the operator-only temporal meta. Lifecycle records follow:
`agent_hop`, `tool_call`, `tool_result`, `tool_retry`, `tool_denied`,
`hop_budget_exhausted`, `ticket_stub_created`, `escalation_rejected`, `turn_result`,
`turn_error`.

Redaction runs over **every** record, not just the ones a call site remembered to sanitise:
keys matching `api_key|secret|token|password|authorization|credential` are replaced, and any
value shaped like a provider key (`sk-…`, `Bearer …`) is scrubbed. Strings are truncated at
2 KB. Writes are best-effort and serialised — a failed log write warns and never fails a turn.

**Note for `@devops.eng`:** `.gitignore:19` ignores `project-context/2.build/logs/`, so the
directory does not survive a fresh clone. `trace.ts` creates it on demand with a recursive
`mkdir`, so **no `.gitkeep` un-ignore is needed**. Flagging rather than changing `.gitignore`.

## Stubs (`*stub-nonmvp`)

`server/runtime/stubs.ts` — nothing in it is registered, imported by the runtime, or
reachable from a turn. Every stub throws `notImplemented(feature, sadRef)` or is a plain data
draft. The standing rule is written into the file: **a stub must never return
plausible-looking fake data**, because an agent that receives invented policy text will
present it as grounded fact.

What remains: SQLite `SessionStore` / `TicketStubStore` (ADR-10, Sprint 2 layer 5) and the
out-of-MVP list (F-WRITE-01 refund writes, F-ANALYTICS-01, F-COP-01, external MCP, session
resume, rate limiting + operator-key auth). The agent drafts and the four tool stubs are gone
because the real things exist.

**DemoOverlay is now built** (`server/data/demoOverlay.ts`, `data/demo_overlay.json`), and it
holds exactly one persona. That is not laziness — it is the rule above applied to data. Every
other demo case comes from real fixture rows, and an overlay persona duplicating data the
database already has would replace grounded evidence with invented evidence. The one gap it
fills was measured: **no user's current membership is a live trial.** Every trial in the
fixture either converted (leaving a paid row behind it) or expired on or before the order
anchor, so after the uniform shift the newest current trial ended *yesterday*. SAD §4
consequence 2 predicted this case precisely. The persona sits on a real user id, so `get_user`
and the order history still resolve against DuckDB; only the membership row is overlaid, and
`overlayHit` now reports honestly instead of being hard-coded `false`.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/chat` | none (rate limited) | The turn. SSE envelope, both engines |
| `GET /api/health` | none | `status`, `duckdb`, `stores`, `engine`, `sdkEngineConfigured`, `operatorTrace` |
| `GET /api/conversations/:id/trace` | **`X-Operator-Key`** | Hop path, per-turn cost, transcript, CSAT, tickets |
| `POST /api/conversations/:id/csat` | none | Record a 1–5 CSAT score for a conversation |

The trace endpoint is the only authenticated surface in the system, and it is authenticated
because of what it returns: the machinery behind a turn, including things the customer never
sees. Everything it returns was already redacted at write time by `trace.ts`, so it cannot
leak what was never stored.

## Durable stores (ADR-10)

Two SQLite databases under `data/`, never the practice DuckDB (ADR-06 — that connection is
read-only and is never written, not even for tickets):

| File | Holds | Env override |
|---|---|---|
| `data/sessions.sqlite` | sessions, transcript, identity, CSAT | `SESSION_DB_PATH` |
| `data/ticket_stubs.sqlite` | `EscalationPackage` rows | `TICKET_STUB_DB_PATH` |

**`node:sqlite`, not `better-sqlite3`.** The durable-store layer adds **zero dependencies** to
a project whose dependency list is itself part of the security story — one fewer native module
to audit, rebuild per platform, and keep patched. The API is synchronous, which suits both
call sites: a turn writes a handful of rows, and the alternative is threading async through
engine code that has no other reason to be async. Schema creation is idempotent and runs on
first open, so a fresh clone works with no migration step.

Both files are gitignored. Set either path to `:memory:` for stateless turns.

## Enabling the sdk engine once a key exists

1. Put `ANTHROPIC_API_KEY` and `MODEL_ID` in `.env.local` (gitignored; never committed).
   `MODEL_ID` is **required, not defaulted** — a silently chosen model makes the Audit line a
   lie and makes evals irreproducible.
2. Set `CHAT_ENGINE=sdk`. Leave `SDK_STREAM_MODE` unset (`final`) for the first runs.
3. `curl localhost:3000/api/health` → expect `"engine":"sdk"`, `"sdkEngineConfigured":true`.
4. `POST /api/chat` with `{"message":"Where is my order?","identity":{"orderId":1},
   "clientFlags":{"trace":true}}` and check, in `project-context/2.build/logs/<id>.jsonl`:
   `prompt_trace` present; `agent_hop` with `hop:1`; `tool_call` for
   `mcp__novamart__get_order`; no `tool_denied`; `turn_result` with the token/cost usage.
5. Then the refund case: `{"message":"Refund me now","identity":{"orderId":1}}` → expect
   `escalation` with `reason_code=payment_or_refund`, `done{status:"escalated"}`, and a
   schema-valid package in `ticket_stub_created`.
6. `CHAT_ENGINE` unset returns the demo to the deterministic engine instantly.

If the key is missing the sdk path produces exactly one thing — an `error` frame with
`code:"sdk_engine_unconfigured"` and `done{status:"escalated"}`. No crash, no stack trace to
the client, and no effect whatsoever on the default path. Verified below.

## Known gaps

1. **The sdk engine is now executed and validated — corrected 2026-08-25.** This entry
   previously read "has never been executed"; that was already stale when written (traces
   dated 2026-08-23 exist) and is now firmly wrong. Both Sprint 1 slices run live against
   `claude-haiku-4-5` and pass 24/24 assertions in `npm run eval:sdk`, five consecutive runs.
   Evidence: [`docs/sample-sdk-turn.md`](../../docs/sample-sdk-turn.md). The first live runs
   found three real defects, all fixed:
   - **Stream-lifecycle race.** The route's `finally` closed the SSE controller while the
     engine was still emitting, so `controller.enqueue` threw `ERR_INVALID_STATE` *from inside
     engine code*. The throw was caught by the engine's own handler and traced as
     `turn_error`, making a turn that had already succeeded look like a failure (2 of 3 traces
     on 2026-08-23). `send` and `close` are now non-throwing, and `cancel()` aborts the turn
     when the consumer disconnects.
   - **Delegation ran asynchronously.** SDK ≥ 0.3.x defaults `Agent` to `run_in_background:
     true`; the tool returned `{status:"async_launched"}` and the coordinator answered without
     ever receiving the specialist's findings — stating order facts no tool had returned,
     which `SAFETY_RULES` forbids. `canUseTool` now rewrites the input to force
     `run_in_background: false`. The prompt asks for it too, but the control is structural.
   - **Duplicate `turn_result`.** A turn can surface more than one `result` message; the first
     now wins.
   Two consequences of forcing synchronous delegation are recorded here rather than buried:
   `TURN_TIMEOUT_MS` default is raised 60s → 120s (a measured two-hop turn runs ~50s, and the
   old budget aborted turns after the work was done), and the SDK background-agent tools
   (`SendMessage`, `ListAgents`, `TaskOutput`, `TaskStop`, `Monitor`) are added to
   `FORBIDDEN_BUILTIN_TOOLS` — an observed turn burned a model turn calling `SendMessage` on a
   specialist that had already returned.
2. **WISMO over-escalation — measured and fixed 2026-08-25.** Recorded because the first fix
   was declared done on too little evidence, and that is the failure mode worth remembering.
   After delegation was made synchronous, `order-specialist` returned correct facts and the
   coordinator still opened a human ticket on some turns — answering a question it had already
   answered. A first prompt change plus five consecutive green eval runs looked like a fix; it
   was not. Sampling single-slice turns directly showed **2 escalations in 7 (~29%)**. Root
   cause: "Where is my order?" implies tracking, this build has no shipment/carrier tool, and
   neither prompt said so — the coordinator read a permanent property of the system as a gap a
   human could close. Both prompts now state that absence explicitly. Re-measured: **0
   escalations in 10** (at the prior rate that outcome has p ≈ 0.03), with refund→escalation
   still **5/5** and `npm run eval:sdk` 24/24. Ten samples bound the residual rate below
   roughly 30%, not to zero, so a regression here should be caught by sampling rather than by
   a single green run.

3. **Temperature no longer exists — resolved 2026-08-23.** Not an SDK gap: `temperature` was
   removed from the Messages API itself on Opus 5 / Sonnet 5 / Opus 4.7+ (sending it returns
   400), so no value could reach the model by any route. `MODEL_TEMPERATURE` has been deleted
   rather than left inert, and the Prompt Trace no longer records a temperature it never
   applied. Determinism is pinned with `effort` (`MODEL_EFFORT`, default `low`) plus a pinned
   `AS_OF_DATE` and the deterministic engine. SAD §2's "≤0.2 for triage" is unimplementable as
   written and needs a one-line amendment (BE-OQ-2, SU-OQ-2).
   Related: the SDK's `maxThinkingTokens` is **deprecated** and model-dependent — replaced by
   `thinking` + `effort` (BE-OQ-6).
4. **`zod` is a direct dependency — resolved 2026-08-25.** `tools.ts` imports `zod` for the
   SDK's `tool()` helper. It previously resolved only as a peer of
   `@anthropic-ai/claude-agent-sdk`, one SDK bump away from breaking; `zod@^4.4.3` is now
   declared in `package.json`.
5. **`needs_input` on the sdk path is structural — resolved 2026-08-25.** The old rule was
   "no hop + a reply ending in `?`". It was wrong twice: it could not tell a clarifying
   question from an answer that happened to end in a question mark, and under
   `SDK_STREAM_MODE=live` it read an always-empty buffer, so the branch was unreachable. The
   coordinator now declares the state with a control marker that the engine strips before any
   token reaches the customer (`server/runtime/needsInput.ts`). The marker is stripped across
   delta boundaries, covered by 9 unit tests including an exhaustive split-at-every-index
   sweep, and `npm run eval:sdk` asserts no fragment ever reaches the wire.
6. **The coordinator answered from model memory — resolved 2026-08-28, structurally.**
   Asked "What is the capital of France?", it replied "Paris" without delegating to anyone.
   Adding an explicit prompt rule ("you do not answer questions; you classify, delegate and
   relay") fixed it for several runs and then it recurred in an eval run — a rule that lives
   only in prompt text is a request, not a control, which is the same lesson the tool
   allowlists already encode. The runtime now checks the OUTCOME instead of trusting the
   instruction: a turn that reached no specialist, opened no ticket and asked the customer
   nothing has answered unaided by definition, whatever it said, and is escalated as
   `ungrounded` (`server/runtime/groundingGuard.ts`). The one exemption is bare pleasantries —
   "hi", "thanks" — matched against the whole message so "hi, where is my order" is not
   exempt. The default is strict: an unrecognised message requires a specialist, so a new
   phrasing costs a needless escalation rather than an ungrounded answer.
7. **The hop budget denied handoffs but forced nothing — resolved 2026-08-28.** ADR-08 says a
   spent budget forces escalation. The `PreToolUse` hook denied the transfer and *told* the
   coordinator to escalate; at `maxHops=1` the observed result was the customer being told
   "let me get that sorted for you now, and I'll follow up shortly", with terminal status
   `resolved` and nobody following up. The runtime now builds the `repeat_failure` package in
   code when the budget is spent, exactly as the deterministic engine does for money intent
   (ADR-16). `tools_tried` and `citations` come from the hook ledger, so the ticket carries
   what happened rather than what a model recalls.
8. **A registered tool no agent could call — resolved 2026-08-28.** `list_orders_for_user` was
   in the tool server and in `REGISTERED_TOOL_NAMES` but in nobody's allowlist, so asked "what
   have I ordered recently?" the specialist truthfully answered that it had no way to look
   that up. An invariant test now asserts every registered tool is granted to at least one
   agent — a tool nothing can call is worse than a missing one, because the failure reads as a
   product limitation.
9. **Two assistant messages ran together mid-sentence — resolved 2026-08-28.** In
   `SDK_STREAM_MODE=live`, a coordinator that spoke before delegating and again afterwards
   produced "...connect you with a human agent for that.I'm not able to process refunds". The
   engine now emits a paragraph break at the message boundary. The prompt also asks for one
   reply per turn, written after the work, so the repetition that made this visible is gone
   too.
10. **Sessions are durable and multi-turn — resolved 2026-08-28 (ADR-10).** Every turn used to
   start cold: "can I return it?" after an order lookup was unanswerable, and identity given in
   turn 1 was thrown away by turn 2. `data/sessions.sqlite` now stores the transcript and the
   last identity; the coordinator receives `conversation_so_far` in its prompt. **Facts are not
   carried forward, only what was said** — the prompt states that history is context, never
   evidence, so an order status quoted twenty minutes ago is never restated as current. Every
   turn re-reads what it needs, which is cheap against a local DuckDB.
11. **Ticket stubs are durable — resolved 2026-08-28 (ADR-10).** `data/ticket_stubs.sqlite`.
   The Sprint 1 idempotency contract is unchanged but now enforced by a `UNIQUE INDEX` on
   `(conversation_id, reason_code)` rather than a scan of a Map, so a replayed turn cannot open
   a second ticket and "a human will pick this up" survives a restart. Verified by restarting
   the server and reading the stub back through the operator endpoint.
12. **`GET /api/conversations/:id/trace` is built — resolved 2026-08-28.** Returns the hop path,
   per-turn cost/usage, the transcript, the CSAT record and the tickets opened. **It fails
   closed**: with `OPERATOR_KEY` unset it returns 503 and reads nothing, rather than treating
   an unset key as "no check required" — an endpoint that becomes public when someone forgets
   an env var is worse than one that is switched off. The conversation id is sanitised before
   it reaches `path.join`, so `..%2f..%2fetc%2fpasswd` resolves to a harmless filename (404).
13. **Rate limiting is in — resolved 2026-08-28.** Fixed window, 20 turns/minute/client,
   `RATE_LIMIT_PER_MIN` to tune, `0` to disable. It runs before body parsing, because the
   thing being protected is the operator's API key on an unauthenticated endpoint: a loop
   against `/api/chat` on the sdk engine is a bill, not just load. It is a **cost guard, not
   access control** — per-process, and keyed on a spoofable client address. Recorded that way
   for `@security.eng` rather than dressed up.
14. **CSAT is wired end to end — resolved 2026-08-28 (F-CSAT-01, backend half).** The route
   emits `csat_prompt` immediately before `done` on any turn that actually finished, and never
   on `needs_input` — asking someone to rate an unanswered question is its own small insult.
   `POST /api/conversations/:id/csat` records a 1–5 score with an optional comment, overwriting
   rather than duplicating. The UI for it belongs to `@frontend.eng`.
15. **`needs_input` is decided by the runtime — resolved 2026-08-29 (INT-03).** Gap 5 above
   made the marker structural; it did not make it guaranteed, because the marker is still
   model-emitted. An unknown order produced a clarifying question with `done{resolved}` and —
   once CSAT landed — a satisfaction survey underneath an unanswered question, while the
   deterministic engine returned `needs_input` for identical input, which ADR-16/ADR-18 make a
   contract violation rather than a divergence. The engine now also decides from evidence: a
   turn that **attempted data lookups and got no successful result from any of them** is
   `needs_input`. This is ADR-17's third case, after the hop budget and the unaided answer.

   **Two wrong signals were tried first, and both are worth recording.** The first counted
   "every tool call failed" from the outcome ledger — dead on arrival, because the `Agent`
   delegation tool is itself recorded as a successful call, so the condition could never be
   true. The second fixed that by excluding delegation and still changed nothing: **a tool
   that returns an error never reaches `PostToolUse` at all**, so the failing `get_order` left
   a `tool_call` with no matching `tool_result` and was invisible in the very ledger the rule
   was reading. Attempts are now recorded at `PreToolUse` and compared against successes at
   `PostToolUse`. A ledger of outcomes cannot answer a question about absences.

   Deliberately unchanged: `ok: true` with an empty result stays `resolved`. "You have never
   had a Plus membership" is a complete answer from a successful lookup, and reporting it as
   `needs_input` would ask the customer for something they already gave.
16. **The guard opened tickets for people saying goodbye — resolved 2026-08-29 (DEF-08).**
   QA measured four of eight common sign-offs escalating: "Thanks, that is all" opened a real
   ticket and promised a follow-up on a conversation that had already ended happily. The
   grounding guard matched pleasantries as whole PHRASES, and a natural closing is a compound
   — "ok thanks, bye" is two pleasantries and matched neither. Matching moved from the phrase
   to the word: a message is conversational when every word in it is conversational, so
   "where", "order" and "refund" still force a specialist while an unlisted way of saying
   goodbye no longer costs a human's attention. A question mark forces a specialist regardless
   of vocabulary. The guard's own note called an unrecognised phrasing "a needless escalation";
   what it undersold is that an escalation is a ticket, a promise, and someone's time.
17. **An explicit budget was silently replaced by the default — resolved 2026-08-29 (DEF-07).**
   `MAX_HOPS=0` executed as 4. `intFromEnv` accepted only `parsed > 0`, so zero, negatives and
   **any typo** became the default with no warning — while `RATE_LIMIT_PER_MIN` already treated
   `0` as "disabled", so the codebase disagreed with itself. It also contradicted this
   project's own rule that `MODEL_ID` is not defaulted because a silently chosen value makes
   the Audit a lie. Unset now falls back; **set-but-invalid throws**, naming the variable, the
   value and the way out. `0` is accepted where it means something (`MAX_HOPS`,
   `TOOL_READ_RETRIES`) and rejected where it does not (`TURN_TIMEOUT_MS`).
18. **App context reached no ticket — resolved 2026-08-29 (AC-TRIAGE-03 / AC-TICKET-01 /
   AC-ESC-05).** `create_ticket_stub` had accepted `device` and `app_version` since Sprint 1
   and **nothing ever populated them**: no prompt asked any agent to capture them, so an
   app-crash ticket reached a human without the two fields an engineer needs first. Three
   acceptance criteria were failing for that one reason.

   Fixed as a **runtime derivation, not a prompt line** (`server/runtime/escalationContext.ts`,
   import-free and unit tested). The customer wrote "Android 3.2.0"; the runtime already has
   those words. This is the same doctrine `tools.ts` already applies to `conversationId`,
   `tools_tried` and `citations` — observations, not judgements — and it extends to the
   session, because a customer describes their device once and escalates two turns later.

   The extractor refuses to guess: an absent field stays absent, and a bare two-part number
   needs a `v`/`version` label so a total like `$175.05` or "3 to 5 business days" can never
   be filed as an app version. Precedence puts the runtime **last**, which was a correction:
   the first version let the model's re-typed value win, observed live as `"Android"` where
   the extractor had `"android"`. Harmless there, and the same order would have let a
   mis-remembered version through. The model still owns `order_id` and `user_id`, which it
   resolves from context the extractor cannot see.

   **AC-ESC-05 was bigger than ADR-13's corner.** The PRD writes out a full normative
   intent→category map, and the deterministic engine had been sending a hand-picked
   `"billing"` where the map says `payment_issue`. The whole map is now a lookup in code — a
   table the PRD wrote out in full has no business being a probability.

   One schema consequence: `sessions` gained two columns, and `CREATE TABLE IF NOT EXISTS`
   does nothing to a table that already exists. `sqlite.ts` now runs an **additive** column
   migration on open. Additive only, deliberately — `ADD COLUMN` is safe in both directions,
   while a rename or retype is not and would need a real migration path with a version table.
   `deploy.md` flagged this as the first thing to break when the schema moved; it moved, and
   it did not break.
19. **Turbopack warning on the DuckDB read** is unchanged and now also appears via
   `app/api/health/route.ts` — a dynamic `path.join(process.cwd(), …)`, warning only.

## Verification

`npm run typecheck` — exit 0, no output:

```text
> multi-agent-cs-crew@1.0.0 typecheck
> tsc --noEmit
```

`npm run test:invariants` — 9 passed, 0 failed (zero-money-tools exact-set suite).

`npm test` — **143 passed, 0 failed** (41 before Sprint 2, 70 after layer 5, 125 after the QA pass, 135 with the DEF-07/DEF-08/INT-03 regression tests). New: 11 policy-scorer tests
covering the 0.55 gate, section retrieval, off-corpus rejection and stemmer collisions; 5
grounding-guard tests; 8 session/stub-store tests against a real SQLite file in a temp
directory; 5 rate-limit tests; plus the orphan-tool invariant.

The store tests need the `@/` path alias, which `tsc` understands and Node does not — until
now every tested module was deliberately import-free, a good constraint for pure logic and an
impossible one for a store whose whole job is to talk to SQLite. `scripts/test-resolver.mjs`
maps the aliases for the test process only (`node --import`), which is a smaller price than
bending the production import style around the test runner or leaving the durable stores
untested.

### The six-agent crew, live (2026-08-28)

`npm run eval:sdk` — **102/102 checks across 8 scripts**, on `claude-sonnet-5`,
`SDK_STREAM_MODE=live`, server pinned at `AS_OF_DATE=2026-09-01`.

| Script | Path exercised | Result |
|---|---|---|
| A WISMO | `order-specialist` → `get_order` | `resolved` |
| B refund | `escalation-handoff`, money intent | `escalated` / `payment_or_refund` |
| C return status | the external holiday calendar is actually invoked | `resolved`, no invented timeline |
| D policy | `faq-policy` → `search_policy` above the gate | `resolved` + `policy:` citation |
| E ungrounded | corpus cannot answer | `escalated` / `ungrounded` |
| F membership | `plus-specialist` + the DemoOverlay persona | `resolved` + `overlay:` citation |
| G returns | order **and** policy in ONE hop | `resolved`, `hops === 1` |
| H restricted | cancel a membership | `escalated` / `restricted_action` |

Every script also runs the shared checks: exactly one `done`, no `error` frame, no control
marker on the wire, no `turn_error` in the trace, and **zero money tools invoked at runtime**.
That last one is a different claim from `test:invariants`, which proves no money tool is
*registered*; this proves none was *called*.

**One eval assertion was wrong, and it is worth recording why.** Slice E ("What is the capital
of France?") required the coordinator to delegate to `faq-policy` and get a not-covered report.
It failed on a run where the coordinator tried to answer alone and the grounding guard caught
it instead — the right outcome by the other legal route. The assertion was testing the
mechanism rather than the promise. It now asserts the promise (the customer never receives an
ungrounded answer) and *prints* which route the run took, so the variability stays visible
instead of being encoded as a requirement.

**Layer 5 verified live, 2026-08-28**: a follow-up turn ("Can I still return it?") with no
identity supplied resolved "it" to order 46101 from the stored session and re-read the order
through the tools; `csat_prompt` observed in position `session → token → token → csat_prompt →
done`; a CSAT score of 5 written and read back through the operator endpoint; the trace
endpoint returning 401 without a key, 401 with a wrong key, 404 on a traversal attempt, and
the full hop path with the right key; 429 on the 21st request in a minute with `Retry-After:
60`; and a ticket stub read back **after a server restart**.

Manually verified beyond the eval set, same session: `list_orders_for_user` by user id with no
order id to hand; a missing order id → `done{needs_input}`; the hop budget spent at
`MAX_HOPS=1` → `hop_budget_exhausted` then `forced_escalation` with a real ticket; a bare
greeting → `resolved` with no escalation (the grounding guard's exemption); and the
deterministic engine unchanged — WISMO `resolved`, refund `escalated`, "why was my order
cancelled" still `resolved` rather than over-escalating.

`npx next build` — compiled successfully; routes `/`, `/api/chat`, `/api/health`. One
pre-existing Turbopack dynamic-filesystem-access warning from the DuckDB read; no errors.

**Default engine, no `CHAT_ENGINE`, no API key** (`POST /api/chat`, `orderId: 1`,
`AS_OF_DATE` unset so `asOf = 2026-08-23`, `shiftDays = 599`):

```text
EVENT {"type":"session","conversationId":"d5679ed8-…"}
EVENT {"type":"citation","ids":["duckdb:orders:1","duckdb:order_items:1"]}
EVENT {"type":"done","status":"resolved"}
REPLY>>>
Order 1 is completed.
Placed 2025-08-23 (365 days ago). Order total $64.36.
Items:
- BalanceSet Yoga Max x1 — $58.37
I can't process refunds, cancellations, or payments here.

x-novamart-as-of: 2026-08-23
x-novamart-shift-days: 599
x-novamart-overlay-hit: false
x-novamart-engine: deterministic
```

Also verified on the default engine: no-identity → `done{needs_input}`; unknown order
`99999999` → not-found copy + `done{needs_input}`; `trace:true` → `agent_hop{hop:1}` +
`tool_call{get_order}`; malformed JSON → `400 invalid_json`; `{}` → `400 invalid_request`;
`GET /api/health` → `{"status":"ok","runtime":"claude-agent-sdk","duckdb":"ok",
"engine":"deterministic","sdkEngineConfigured":false}`.

**sdk engine with no key** (`CHAT_ENGINE=sdk`, `ANTHROPIC_API_KEY` empty):

```text
data: {"type":"session","conversationId":"b9735127-…"}
data: {"type":"error","code":"sdk_engine_unconfigured","message":"The sdk engine needs ANTHROPIC_API_KEY. Set it in .env.local, or unset CHAT_ENGINE to use the deterministic engine.","retryable":false}
data: {"type":"done","status":"escalated"}
```

Clean frame, no crash, no stack trace, server log silent. Server stopped and port 3000 freed
after the run. `git status` shows only the intended files — no `.duckdb`, no `.env*`, no logs.

---

## Sources

1. `project-context/1.define/sad.md` — §2 crew spec + hop accounting + runtime config table,
   §4 API contracts / data / temporal layer, Sprint 1 slice, ADR-03/05/06/07/08/09/10/14.
2. `project-context/1.define/prd.md` — §3.2 agent definitions, §3.3 interaction patterns,
   §3.4 integration requirements, F-ORDER-01 / F-ESC-01 / F-TICKET-01 / F-TIME-01 / NFR-SAFE-01.
3. `.claude/rules/adapter-claude-agent-sdk.md` — the only adapter loaded.
4. `.claude/rules/aamad-core.md`, `.claude/rules/adapter-registry.md`.
5. `aamad.config.yml` — `runtime.target: claude-agent-sdk`, TS primary, strict types,
   `max_file_lines: 400` (largest new file: `engines/sdk.ts`, 320).
6. `packages/shared/src/dto.ts` (frozen), `project-context/2.build/frontend.md`,
   `frontend-functional-spec.md`.
7. `node_modules/@anthropic-ai/claude-agent-sdk@0.3.241` — `sdk.d.ts` (`AgentDefinition`,
   `Options`, hook input types, `createSdkMcpServer`, `tool`, `query`).

## Assumptions

1. **`project-context/2.build/setup.md` does not exist yet.** `@project.mgr` writes it after
   this epic. Setup facts used here (Node 25.9.0, Next 16.3.1, TS 5.9, strict, path aliases
   `@/*` and `@shared/*`) were read from `package.json` / `tsconfig.json`, not invented.
2. The CI fixture `data/fixtures/novamart_ci.duckdb` stays the default DB path
   (`server/data/duckdb.ts:14`), overridable by `NOVAMART_DUCKDB_PATH`. Per SAD-OQ-6 this is
   settled; nothing here changed it, and the 151 MB practice DB was never touched or staged.
3. In-memory ticket stubs and per-turn session state satisfy Sprint 1 (SAD explicitly allows
   it) as long as the DTO shapes are honored — they are.
4. `next dev` on port 3000 was unavailable because a pre-existing dev server for this repo
   was already running on 3111 and Next 16 enforces one dev server per directory. Rather than
   kill an operator's process, verification ran `next build` + `next start -p 3000`, which
   exercises the same route handlers; the pre-existing dev server was re-checked afterwards
   and is healthy. `next build` rewrote `next-env.d.ts` to the build variant; it was restored
   to the dev variant and typecheck re-run clean.
5. Adding `test:invariants` to `package.json` scripts is a script change, not a dependency
   change — it uses the Node built-in test runner and native type stripping.

## Open Questions

| ID | Question | Status |
|----|----------|--------|
| BE-OQ-1 | Should `zod` be promoted to a direct dependency? `tools.ts` needs it for the SDK `tool()` helper but it arrives transitively. | Open — `@project.mgr` / setup epic |
| BE-OQ-2 | ~~SAD §2 mandates temperature ≤0.2, but SDK `0.3.241` `Options` exposes no temperature knob.~~ **RESOLVED 2026-08-23** — not an SDK gap: `temperature` was removed from the Messages API itself on Opus 5 / Sonnet 5 / Opus 4.7+ (sending it returns 400), so no temperature could reach the model by any route. Determinism is now pinned with `effort` (`MODEL_EFFORT`, default `low`). `MODEL_TEMPERATURE` has been deleted rather than left inert, and the Prompt Trace no longer records a temperature it never applied. SAD §2's "temperature ≤0.2" line is now unimplementable as written and needs a one-line amendment from `@system.arch` to name `effort` instead. | Resolved in code; SAD wording open — `@system.arch` |
| BE-OQ-3 | `needs_input` detection on the sdk path is a heuristic. Adopt a structured terminal-message contract for the coordinator? | Open — `@integration.eng` |
| BE-OQ-4 | SAD §4 specifies `GET /api/conversations/:id/trace` with `X-Operator-Key`, and a 429 rate limit. Both are deferred. Confirm they are Sprint 2, not a Sprint 1 exit gap. | Open — `@qa.eng` / `@security.eng` |
| BE-OQ-5 | The Sprint 1 exit criteria require an eval harness (SAD "Eval harness lands in Sprint 1"). | **Closed 2026-08-25** — `scripts/eval-sdk.mjs` (`npm run eval:sdk`) drives both slices against a running server and asserts on the SSE wire and the JSONL trace: 24 checks, 5 consecutive green runs on `CHAT_ENGINE=sdk`. Includes a runtime zero-money-tool check, which is a distinct claim from the registration-time invariant in `npm run test:invariants`. |
| BE-OQ-6 | `MAX_THINKING_TOKENS` previously fed the SDK's **deprecated** `maxThinkingTokens` option, whose meaning is model-dependent — on Opus 4.6 any non-zero value is a plain on/off switch, so the old default of `1024` never capped thinking at 1024 tokens as its comment claimed. Now replaced by `thinking` + `effort`; `MAX_THINKING_TOKENS` is retained but applies to OLDER models only (e.g. `claude-haiku-4-5`) and must stay unset on Opus 4.6+ / Sonnet 4.6+ / Opus 5 / Sonnet 5, which require adaptive thinking. Confirm the intended model tier. | Open — `@system.arch` / `@qa.eng` |

**No SAD conflicts found.** The three-of-six registered roster is not a deviation: SAD Sprint 1
names the other three as out of scope, and SAD §2 keeps six as the *MVP* roster, which the
drafts in `stubs.ts` preserve. The CI-fixture default matches SAD-OQ-6 as resolved.

## Audit

| Field | Value |
|-------|-------|
| Persona id | `backend-eng` |
| Actions | `*develop-be`, `*define-agents`, `*implement-endpoint`, `*stub-nonmvp`, `*document-backend` |
| Timestamp | 2026-08-23T19:28:47Z (`date -u`) |
| Resolved runtime | `AAMAD_TARGET_RUNTIME=claude-agent-sdk` — from `AAMAD_TARGET_RUNTIME` in `.claude/settings.json` `env`, agreeing with `aamad.config.yml:12` `runtime.target`. Only `.claude/rules/adapter-claude-agent-sdk.md` was loaded; the `crewai` and `cursor-sdk` adapter files were not read. |
| SDK version | `@anthropic-ai/claude-agent-sdk@0.3.241` (already installed; nothing installed, upgraded or removed) |
| Resolved model | **none** — `MODEL_ID` is unset in this environment and is required, not defaulted, so no sdk turn can run. Recorded per-run in the Prompt Trace once set. |
| Temperature | **n/a** — removed from the Messages API on current models; `MODEL_TEMPERATURE` deleted 2026-08-23. Determinism uses `effort` (see Known gaps 2) |
| Token controls | `maxOutputTokens` 4096 (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`), `effort` `low` (`MODEL_EFFORT`), `thinking` adaptive unless `MAX_THINKING_TOKENS` is set, `maxTurns` 12, `turnTimeoutMs` 60000, `maxHops` 4, `toolReadRetries` 1 |
| Prompt Trace | Captured pre-execution in `server/runtime/trace.ts` → `project-context/2.build/logs/<conversationId>.jsonl`, redacted. No trace files were produced in this task because no sdk turn ran past preflight. |
| Verification | `npm run typecheck` exit 0 · `npm run test:invariants` 9/9 · `npx next build` compiled · default-engine SSE smoke on `orderId 1` with no API key returned the grounded reply verbatim · sdk-engine-without-key returned one clean `sdk_engine_unconfigured` frame · port 3000 freed · `git status` clean of `.duckdb` / `.env*` |
| Inputs | `prd.md`, `sad.md`, `frontend.md`, `frontend-functional-spec.md`, `aamad.config.yml`, adapter rule, existing backend code |
| Outputs | `project-context/2.build/backend.md`, `server/runtime/**`, `app/api/chat/route.ts`, `app/api/health/route.ts`, `.env.example`, `package.json` (one script) |
| Handoff | `@integration.eng` (no DTO change; sdk path needs a live key run), `@qa.eng` (eval harness, BE-OQ-5), `@project.mgr` (setup.md + BE-OQ-1) |
