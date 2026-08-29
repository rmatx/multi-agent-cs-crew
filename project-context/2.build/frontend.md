# Frontend Epic — NovaMart Support MVP

Detailed contract: **`frontend-functional-spec.md`** (repo root). Not duplicated here.

## Built (Sprint 1 vertical slice)

- `packages/shared/src/dto.ts` — frozen DTOs copied verbatim from SAD §4 (`ChatRequest`,
  `StreamEvent`, `ReasonCode`, `EscalationPackage`) + tool-result/temporal summary shapes.
  Every other module imports these; none restate them.
- `app/page.tsx` + `app/page.module.css` — single chat column: crew status banner (colour
  pill, "last updated" clock, `role="status"`), identity bar, token-incremental message list,
  results area, composer. Controls are **Run** / **Reset** plus an inline **Retry** on
  retryable errors that replays the held `lastRequest`, not the current form. CSS modules.
- `lib/status.ts` — one source of status wording and tone (gray/blue/green/red, amber
  `attention` when the turn waits on the customer, violet `handoff` when a person has it);
  banner and `Run` / `Running…` read it.
- `lib/fsm.ts` — `idle → running → done{resolved|escalated|needs_input}`, typed off
  `StreamEvent`; illegal transitions unrepresentable.
- `lib/chatClient.ts` — validation + drives the FSM from the stream.
- `lib/services/turnService.ts` — `startTurn` (SSE) / `getTurnTrace`; replaces the
  generic `startRun`/`getRunStatus` because ADR-04 makes this streaming, not poll-based.
- `lib/services/mockStream.ts` — dev mock over the same DTO types (`NEXT_PUBLIC_USE_MOCK_STREAM=1`).
- `app/api/chat/route.ts` — real SSE handler; deterministic grounded reply from the tool
  result, **no LLM call** in this slice.
- `server/data/duckdb.ts` — READ ONLY connection, `NOVAMART_DUCKDB_PATH` → CI fixture fallback.
- `server/data/dateShift.ts` — `shiftDays = asOf − max(order_date)`, honors `AS_OF_DATE` /
  `DATE_SHIFT_DAYS`. Raw dates never leave the server.
- `.env.example` (names only), `tsconfig.json` (strict), `next.config.ts`.

## Built (Sprint 2 layer 5 — 2026-08-28)

The backend now emits `csat_prompt`, records CSAT, and serves an operator trace. This pass is
the UI half of that, plus the F-CHAT-01 control that was never built.

- **`components/TracePanel.tsx`** (+ CSS module) — F-TRACE-01. Collapsible, hidden by default,
  opened by `?trace=1` or the toggle (SAD §3). Shows the turn's `{ asOf, shiftDays,
  overlayHit }`, the engine, the conversation id, and the ordered step list: hops, tool calls,
  citations, escalation, terminal status. Hop and tool-call counts are shown separately in the
  header because they are different things — a hop is an agent transfer, and the panel would
  otherwise invite the reading the runtime spent five layers preventing.
- **`components/CsatPrompt.tsx`** (+ CSS module) — F-CSAT-01. Appears only when the server
  sends `csat_prompt`. 1–5 with worded labels rather than stars (the endpoint stores 1–5, so
  the UI says what 1–5 means), optional comment, dismissible, one click completes the common
  case.
- **"Talk to a human"** — F-CHAT-01, always visible beside the composer. It sends a message
  like any other rather than calling an escalation endpoint of its own: the crew already routes
  an explicit human request to `escalation-handoff` with `customer_requested_human`, and a
  second path to the same outcome is a second thing that can disagree with the first.
- **"Email support", disabled with a note** (`*add-placeholders`) — visible and inert. A stub
  that looks live is a promise the build cannot keep.
- **`lib/fsm.ts`** — added a `trail` of `TraceEntry` alongside `activity`. `activity` answers
  "what is happening now" for the banner; the trail answers "what happened" for the panel. Kept
  separate because a banner that had to summarise a list would either lie or grow.
- **`lib/text.ts`** — strips markdown emphasis at render time (see Defects, 3).
- **`lib/services/turnService.ts`** — `startTurn` takes an `onHeaders` callback for the
  `X-Novamart-*` metadata, and `getTurnTrace` is implemented against the real route.

### Two boundaries this pass respected

**The client decides nothing about the turn.** It does not decide when to ask for a rating —
the server sends `csat_prompt`, and never on `needs_input`. It does not decide what the
operator may see — `agent_hop` and `tool_call` are withheld server-side when trace is off, so
with the switch off the panel is **empty rather than filtered**, and its empty state says so.
That is the customer/operator split being enforced on the wire, and the UI does not work
around it.

**Endpoint shapes stay out of components** (`@frontend.eng` → `@integration.eng`). `CsatPrompt`
knows only `submitCsat(...)`, exactly as the composer knows only `runTurn(...)`. The new
`lib/services/csatClient.ts` sits beside `turnService.ts`, where integration already owns the
wire, rather than a `fetch` spreading through JSX. Recorded here as an integration touchpoint.

## Defects found by using it (2026-08-28)

Found by driving the real UI in a browser, not by reading it.

1. **An escalated turn announced itself as "needs input".** `needs_input` and `escalated`
   shared the amber `attention` tone AND its label, so a turn that had opened ticket
   STUB-E0420689 and told the customer a human would pick it up displayed *"Crew: needs
   input — Could not answer with what it has."* The banner asked the customer to act while the
   answer below it said the opposite. They are both non-failures, so neither is green, but they
   ask **opposite things of the reader** and cannot share a word. Escalated now has its own
   tone (violet) and label ("handed off — A person has this now"), asserted in `status.test.ts`.
2. **The ticket id was invisible in the result line.** "Handing this to a human." is true and
   useless; the id is the only thing a customer can quote to a person. The result line now
   reads *"Handed to a human. Ticket STUB-E0420689 — you asked for a person."*, with reason
   codes phrased for a customer rather than shown as `customer_requested_human`.
3. **Raw markdown reached the customer.** The reply rendered `**STUB-63311DF3**`, asterisks
   included, because the coordinator emits occasional markdown and this client renders text.
   Adding a markdown renderer would mean a dependency, a sanitiser and an XSS surface for the
   sake of bold nobody asked for; adding another prompt line would be a request, and the
   recurring lesson on this project is that a rule living only in prompt text is not a control.
   `lib/text.ts` strips paired emphasis and list markers **at render time** — the transcript
   still stores what the server sent, so a trace and the screen never disagree. It is
   deliberately narrow, and the tests pin the false positives that would matter: `2 * 3`,
   `order_date`, `mcp__novamart__get_order`.

## Client-side tests — the gap `integration.md` OQ-6 recorded

That question noted `lib/fsm.ts` and `lib/status.ts` are pure, trivially testable and untested
while `aamad.config.yml` sets `testing.require_unit_tests: true`. The obstacle was real: the
client modules import `@shared/dto`, and Node's test runner could not resolve the alias.
`scripts/test-resolver.mjs` (added with the durable stores) removes it, so the gap had no
excuse left. **22 client tests** now cover the FSM contract (the client never decides that a
turn ended or how), the status vocabulary, and the markdown stripper.

## Deferred (still)

The pause / cancel / retry-diff controls, a rendered markdown surface, and an operator console
around `GET /api/conversations/:id/trace` — the route exists and `getTurnTrace` calls it, but a
browser is the wrong place to hold the operator secret, so the chat page renders the frames it
was sent rather than reading the server's record. **Money tools: never.**

## Verification run

`npx tsc --noEmit` clean · `next build` compiled successfully (one Turbopack
dynamic-filesystem-access warning from the DuckDB read; no errors) · dev server +
`curl POST /api/chat` for order ids 1, 46101, 42776, 99999999, and a no-identity request:
with `AS_OF_DATE=2026-08-13`, `shiftDays=589`, order 1 streamed `2025-08-13` and 46101
`2026-08-13 (today)` — shifted, not 2024; fixture byte-identical after · browser pass:
keyboard-only entry, idle → running → done transitions (incl. amber needs-input), Reset
clearing the transcript, zero console errors.

## Verification run — 2026-08-28

`npx tsc --noEmit` clean · `next build` compiled (routes `/`, `/api/chat`, `/api/health`,
`/api/conversations/[id]/csat`, `/api/conversations/[id]/trace`) · `npm test` **92 passed**
(70 server + 22 client) · browser pass against the live sdk engine at `AS_OF_DATE=2026-09-01`:
`?trace=1` opened the panel and switched trace on; a returns question rendered
`hop 1 → Returns advisor called get_order → called search_policy → sources → done resolved`
with `as of 2026-09-01`, `608 days`, overlay `no`; a CSAT score of 5 was submitted from the UI
and read back from the server as `{"score":5}`; **Talk to a human** produced ticket
STUB-E0420689 with reason `customer_requested_human` and the handed-off banner. Screenshots:
[`docs/screenshots/04-trace-and-csat.png`](../../docs/screenshots/04-trace-and-csat.png),
[`docs/screenshots/05-handoff-banner.png`](../../docs/screenshots/05-handoff-banner.png).
Zero console errors other than a pre-existing missing `favicon.ico`.

## Sources

- `frontend-functional-spec.md` (repo root) — the detailed UI/workflow contract this artifact
  deliberately does not duplicate
- `project-context/1.define/sad.md` — §3 Frontend Architecture (stack, UI requirements, the
  "trace hidden by default; `?trace=1` or toggle" rule), §4 `StreamEvent` contract
- `project-context/1.define/prd.md` — F-CHAT-01, F-CSAT-01, F-TRACE-01, AC-CHAT-01…05
- `project-context/2.build/backend.md` — the frames the server actually emits
- `project-context/2.build/integration.md` — envelope, `csat_prompt` position, OQ-6
- `packages/shared/src/dto.ts` — the frozen types every component imports and none restate
- `aamad.config.yml` — `ui.theme: system`, `ui.visual_style: minimal`
- Browser verification runs, 2026-08-13 and 2026-08-28, both engines plus mock mode

## Assumptions

1. **Desktop-first, single column.** `visual_style: minimal` and one chat surface. Responsive
   down to a narrow viewport by using flexible widths, but no mobile-specific layout was
   designed or tested on a device.
2. **The customer is the primary reader; the operator is secondary.** Trace is collapsed and
   off unless asked for, per SAD §1 principle 1. Everything an operator needs beyond the panel
   lives in the trace endpoint, not in this UI.
3. **No design system or component library.** CSS modules and hand-written components — the
   project's dependency budget is spent deliberately, and a UI kit was not worth it for one
   page (the same reasoning that declined a markdown renderer).
4. **Accessibility is best-effort AA**, per the SAD: semantic landmarks, `role="status"` on the
   banner, keyboard-only operation verified by hand. No screen-reader pass and no automated
   audit has been run.
5. **The rendered transcript is per-page state.** The durable one lives in `sessions.sqlite`;
   a reload loses the display, not the conversation.
6. Verified in Chromium via Playwright. Safari and Firefox were not driven.

## Open Questions

| ID | Question | Owner |
|---|---|---|
| FE-OQ-1 | Should the React surfaces get component tests? `fsm.ts`, `status.ts` and `text.ts` are covered; `TracePanel` and `CsatPrompt` are verified only by browser driving, and a component harness would be this project's first test-framework dependency. | `@qa.eng` / operator |
| FE-OQ-2 | Is a mobile layout in scope for the capstone demo, or is desktop-only acceptable? | Operator |
| FE-OQ-3 | The assistant occasionally emits markdown, stripped at render (`lib/text.ts`). Should the UI render markdown properly instead, accepting a renderer and its sanitiser? | `@frontend.eng` |
| FE-OQ-4 | Package substitution `duckdb` → `@duckdb/node-api`, carried from `frontend-functional-spec.md`. Recorded there; no UI consequence. | `@project.mgr` |

## Audit

| Field | Value |
| ----- | ----- |
| Persona id | `frontend-eng` |
| Action | `*develop-fe`, `*style-ui`, `*add-placeholders`, `*document-frontend`; 2026-08-13 status-visibility pass (crew banner + pill + timestamp, `lib/status.ts`, Run/Reset/Retry, duplicate-React-key fix in `append`, README local run steps); **2026-08-28 Sprint 2 layer 5 pass** (TracePanel, CsatPrompt, Talk-to-a-human, deferred-feature stub, FSM trail, markdown stripper, first client-side tests) |
| Timestamp | 2026-08-13; amended 2026-08-28 |
| Resolved runtime | `AAMAD_TARGET_RUNTIME=claude-agent-sdk` |
| Verification | `npx tsc --noEmit` exits 0 and `next build` compiles (one Turbopack warning, no errors) at this pass; browser pass covering keyboard-only entry, banner transitions, Reset clearing the transcript, and zero console errors |
| Open Questions | Section above; the `duckdb` → `@duckdb/node-api` substitution is also tracked in `frontend-functional-spec.md` |
| Compliance | `aamad validate --phase deliver` — Sources / Assumptions / Open Questions added 2026-08-29; they had been missing since Sprint 1 |
