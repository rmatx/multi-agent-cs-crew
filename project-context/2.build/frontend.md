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
- `lib/status.ts` — one source of status wording and tone (gray/blue/green/red + amber
  `attention` for a turn that ended without answering); banner and `Run` / `Running…` read it.
- `lib/fsm.ts` — `idle → running → done{resolved|escalated|needs_input}`, typed off
  `StreamEvent`; illegal transitions unrepresentable.
- `lib/chatClient.ts` — validation + drives the FSM from the stream.
- `lib/services/turnService.ts` — `startTurn` (SSE) / `getTurnTrace` (stub); replaces the
  generic `startRun`/`getRunStatus` because ADR-04 makes this streaming, not poll-based.
- `lib/services/mockStream.ts` — dev mock over the same DTO types (`NEXT_PUBLIC_USE_MOCK_STREAM=1`).
- `app/api/chat/route.ts` — real SSE handler; deterministic grounded reply from the tool
  result, **no LLM call** in this slice.
- `server/data/duckdb.ts` — READ ONLY connection, `NOVAMART_DUCKDB_PATH` → CI fixture fallback.
- `server/data/dateShift.ts` — `shiftDays = asOf − max(order_date)`, honors `AS_OF_DATE` /
  `DATE_SHIFT_DAYS`. Raw dates never leave the server.
- `.env.example` (names only), `tsconfig.json` (strict), `next.config.ts`.

## Deferred (explicitly out of this task, per SAD Sprint 1)

CSAT, TracePanel UI, policy search, `faq-policy` / `plus-specialist` / `returns-advisor`,
escalation + ticket stubs, SQLite session durability, DemoOverlay lookup (`overlayHit` is
reported `false`), `GET /api/conversations/:id/trace`, and the pause / cancel / retry-diff
controls. **Money tools: never.**

## Verification run

`npx tsc --noEmit` clean · `next build` compiled successfully (one Turbopack
dynamic-filesystem-access warning from the DuckDB read; no errors) · dev server +
`curl POST /api/chat` for order ids 1, 46101, 42776, 99999999, and a no-identity request:
with `AS_OF_DATE=2026-08-13`, `shiftDays=589`, order 1 streamed `2025-08-13` and 46101
`2026-08-13 (today)` — shifted, not 2024; fixture byte-identical after · browser pass:
keyboard-only entry, idle → running → done transitions (incl. amber needs-input), Reset
clearing the transcript, zero console errors.

## Audit

| Field | Value |
| ----- | ----- |
| Persona id | `frontend-eng` |
| Action | `*develop-fe`, `*style-ui`, `*document-frontend`; 2026-08-13 status-visibility pass (crew banner + pill + timestamp, `lib/status.ts`, Run/Reset/Retry, duplicate-React-key fix in `append`, README local run steps) |
| Timestamp | 2026-08-13 |
| Resolved runtime | `claude-agent-sdk` |
| Verification | `npx tsc --noEmit` exits 0 and `next build` compiles (one Turbopack warning, no errors) at this pass; browser pass covering keyboard-only entry, banner transitions, Reset clearing the transcript, and zero console errors |
| Open Questions | Tracked in `frontend-functional-spec.md` (notably the `duckdb` → `@duckdb/node-api` package substitution) |
