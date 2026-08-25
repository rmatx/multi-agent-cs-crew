# QA — MVP Validation (Sprint 1)

Persona: `@qa.eng` · Action: `*qa` · Runtime: `claude-agent-sdk` (`AAMAD_TARGET_RUNTIME`)
Date: 2026-08-25 · Commit under test: `8b9a34c`

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

**DEF-04 — `needs_input` under-fires on the sdk path. Severity: low. OPEN.**
Found while writing this document. An unknown order on the sdk engine returns
`done{status:"resolved"}` while the reply text is a clarifying question ("Could you
double-check the order number?"). The deterministic engine returns `needs_input` for the same
input. The marker *mechanism* is sound and unit tested; the marker is *model-emitted*, and
here the coordinator did not emit it. So `needs_input` on the sdk path is structural in
mechanism but not guaranteed in practice — a claim worth stating precisely rather than
rounding up to "fixed". Minor related observation: the specialist called `get_order_items`
after `get_order` had already returned not-found.

**DEF-05 — Engine divergence on terminal status. Severity: low. OPEN.**
DEF-04's general form. The two engines can return different `status` for identical input. No
DTO breach and the customer-visible text is correct on both, but any consumer keying off
`status` sees engine-dependent behaviour. Needs an explicit ruling: is terminal status part of
the frozen contract, or engine-dependent? Carried to `@integration.eng`.

## Coverage against acceptance criteria

Sprint 1 criteria only. The PRD defines 93 requirement ids across all sprints; the majority
belong to unregistered agents and are correctly untested.

| AC | Verified by | Status |
|---|---|---|
| AC-ORDER-01 | `get_order` returns status/totals/dates from DuckDB, both engines | Pass |
| AC-ORDER-02 | Customer text matches tool output; citations `duckdb:orders:1`, `duckdb:order_items:1` | Pass |
| AC-ORDER-03 | Unknown order → clear message + escalation offer | Pass on text; **status differs by engine — DEF-04** |
| AC-ORDER-04 | No mutate/cancel/refund tool exposed | Pass — 5 layers, unit + runtime |
| AC-ESC-01 | Ticket stub carries required package fields | Pass |
| AC-ESC-02 | Customer sees confirmation + summary | Pass |
| AC-ESC-03 | Stub has unique id | Pass — 5 distinct ids over 5 runs |
| AC-ORCH-01 | Per-agent tool allowlists enforced | Pass — unit + observed `tool_denied` on `SendMessage` |
| AC-ORCH-02 | Max hops then escalate | **Not tested** — no fixture forces hop exhaustion |
| AC-ORCH-03 | `SessionState` persists across turns | **Fails by design** — sessions are per-turn in Sprint 1 |
| AC-CHAT-01 | Chat page loads, send/receive | Pass — manual, plus production build |
| AC-CHAT-02 | Responses stream | Pass — token frames observed on both engines |

## Future work

1. **Hop-exhaustion fixture (AC-ORCH-02).** Needs a prompt that forces `MAX_HOPS` delegations.
   The budget is enforced in `hooks.ts` and unit-adjacent, but the end-to-end path is untested.
2. **CI wiring.** `npm test` and `npm run test:invariants` are keyless and belong in CI now.
   `npm run eval:sdk` needs a key and a running server, so it should be a manual or gated job
   — do not put a billed model call in a per-push pipeline without a budget guard.
3. **Frontend tests.** No component or FSM tests exist. `lib/fsm.ts` is pure and the obvious
   first target.
4. **Sprint 2 agents.** Registering `faq-policy`, `plus-specialist` or `returns-advisor` means
   updating `REGISTERED_TOOL_NAMES` and the exact-set test deliberately — that test is designed
   to fail when tools appear, and that failure is the review gate.
5. **Load and concurrency.** Untested. Synchronous delegation makes a turn cost 30–50s of
   wall clock, which has obvious implications for concurrent users.

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

| ID | Question | Status |
|---|---|---|
| QA-OQ-1 | Is terminal `status` part of the frozen wire contract, or engine-dependent? DEF-05 blocks a clean answer. | Open — `@integration.eng` |
| QA-OQ-2 | Is DEF-04 acceptable for Sprint 1, or does `needs_input` need a non-model-emitted signal? | Open — `@backend.eng` |
| QA-OQ-3 | What residual failure rate is acceptable for a graded demo? 10 samples bound WISMO below ~30%, not zero. | Open — operator |
| QA-OQ-4 | Should `eval:sdk` run in CI given it costs money per run? | Open — `@devops.eng` |
| QA-OQ-5 | AC-ORCH-03 (session persistence) fails by design in Sprint 1. Confirm it is deferred, not a gap. | Open — `@system.arch` |

## Audit

| Field | Value |
|---|---|
| Persona | `@qa.eng` |
| Action | `*qa`, `*test-unit`, `*test-integration`, `*log-defects`, `*future-work` |
| Timestamp | 2026-08-25 |
| Resolved runtime | `claude-agent-sdk` (`aamad.config.yml` → `runtime.target`) |
| Commit under test | `8b9a34c` |
| Model | `claude-haiku-4-5`, `MODEL_EFFORT=low`, thinking adaptive |
| Suites run | `npm test` 18/18 · `npm run test:invariants` 9/9 · `npm run eval:sdk` 24/24 · `npm run typecheck` 0 · `npm run build` clean |
| Live turns | 47 billed, ~$3.06 |
| Prompt Trace | Per-turn JSONL under `project-context/2.build/logs/` (gitignored, redacted). Sample committed at `docs/sample-sdk-turn.md`. |

**Next persona:** `@security.eng` (`*assess-security` → `security.md`) before Deliver.
`delivery-workflow.md` gates Phase 3 on this document, which now exists; it also prefers
`security.md`, which does not.
