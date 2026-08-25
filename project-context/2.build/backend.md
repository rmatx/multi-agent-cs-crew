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
| `order-specialist` | yes | `mcp__novamart__get_order`, `…get_order_items` | **no** |
| `escalation-handoff` | yes | `…create_ticket_stub`, `…format_handoff_summary` | **no** |
| `faq-policy` | **no — inert draft** | — | — |
| `plus-specialist` | **no — inert draft** | — | — |
| `returns-advisor` | **no — inert draft** | — | — |

Three registered, not six, and that is deliberate. SAD "Sprint 1 — thin vertical slice"
lists `faq-policy`, `plus-specialist` and `returns-advisor` as explicitly *not* in Sprint 1,
and their tools (`search_policy`, `get_membership`) do not exist. Registering an agent whose
tools are missing gives it exactly one way to answer — from model memory — which is the
"escalate over invent" failure the PRD forbids. They live as inert drafts in `stubs.ts`, and
the coordinator routes their intents to `escalation-handoff` with an honest reason.

**Delegation is structural.** Specialists do not receive the `Agent` tool in `tools`, and
`disallowedTools` names it (and every built-in) explicitly. A specialist cannot spawn another
specialist even under prompt injection, because the capability is absent — not because the
prompt asks it not to. `PreToolUse` denies it a third time if it somehow appears.

## Tools

Four tools, all read-only or ticket-writing, served from an **in-process MCP server**
(ADR-07 — no external MCP server in MVP):

| Tool | Reads | Side effect |
|------|-------|-------------|
| `get_order` | DuckDB `orders`, RO | none |
| `get_order_items` | DuckDB `order_items` + `products`, RO | none |
| `create_ticket_stub` | — | writes an in-memory ticket stub (never the practice DB) |
| `format_handoff_summary` | in-memory stub | none |

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

Covered: the three unregistered agents; `get_user` / `list_orders_for_user` /
`get_membership` / `search_policy`; `DemoOverlay` (which is why `overlayHit` is honestly
`false`); SQLite `SessionStore` / `TicketStubStore` (ADR-10); and the out-of-MVP list
(F-WRITE-01 refund writes, F-ANALYTICS-01, F-COP-01, external MCP, session resume, rate
limiting + operator-key auth).

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
6. **Sessions are per-turn.** No transcript is carried across turns on either engine; SAD
   Sprint 1 permits in-memory session state, and SQLite durability is Sprint 2 layer 5.
7. **Ticket stubs are in-memory** and die with the process (SAD Sprint 1 Slice B allows it).
8. **`GET /api/conversations/:id/trace` is not built.** Operator visibility is the JSONL log
   plus the `X-Novamart-*` response headers, which SAD Sprint 1 accepts.
9. **No rate limiting, no `X-Operator-Key` auth.** SAD §4 lists 429 and operator-key auth;
   both are stubbed as out-of-MVP for `@security.eng` to rule on.
10. **Turbopack warning on the DuckDB read** is unchanged and now also appears via
   `app/api/health/route.ts` — a dynamic `path.join(process.cwd(), …)`, warning only.

## Verification

`npm run typecheck` — exit 0, no output:

```text
> multi-agent-cs-crew@1.0.0 typecheck
> tsc --noEmit
```

`npm run test:invariants` — 9 passed, 0 failed (zero-money-tools exact-set suite).

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
| Resolved runtime | `claude-agent-sdk` — from `AAMAD_TARGET_RUNTIME` in `.claude/settings.json` `env`, agreeing with `aamad.config.yml:12` `runtime.target`. Only `.claude/rules/adapter-claude-agent-sdk.md` was loaded; the `crewai` and `cursor-sdk` adapter files were not read. |
| SDK version | `@anthropic-ai/claude-agent-sdk@0.3.241` (already installed; nothing installed, upgraded or removed) |
| Resolved model | **none** — `MODEL_ID` is unset in this environment and is required, not defaulted, so no sdk turn can run. Recorded per-run in the Prompt Trace once set. |
| Temperature | **n/a** — removed from the Messages API on current models; `MODEL_TEMPERATURE` deleted 2026-08-23. Determinism uses `effort` (see Known gaps 2) |
| Token controls | `maxOutputTokens` 4096 (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`), `effort` `low` (`MODEL_EFFORT`), `thinking` adaptive unless `MAX_THINKING_TOKENS` is set, `maxTurns` 12, `turnTimeoutMs` 60000, `maxHops` 4, `toolReadRetries` 1 |
| Prompt Trace | Captured pre-execution in `server/runtime/trace.ts` → `project-context/2.build/logs/<conversationId>.jsonl`, redacted. No trace files were produced in this task because no sdk turn ran past preflight. |
| Verification | `npm run typecheck` exit 0 · `npm run test:invariants` 9/9 · `npx next build` compiled · default-engine SSE smoke on `orderId 1` with no API key returned the grounded reply verbatim · sdk-engine-without-key returned one clean `sdk_engine_unconfigured` frame · port 3000 freed · `git status` clean of `.duckdb` / `.env*` |
| Inputs | `prd.md`, `sad.md`, `frontend.md`, `frontend-functional-spec.md`, `aamad.config.yml`, adapter rule, existing backend code |
| Outputs | `project-context/2.build/backend.md`, `server/runtime/**`, `app/api/chat/route.ts`, `app/api/health/route.ts`, `.env.example`, `package.json` (one script) |
| Handoff | `@integration.eng` (no DTO change; sdk path needs a live key run), `@qa.eng` (eval harness, BE-OQ-5), `@project.mgr` (setup.md + BE-OQ-1) |
