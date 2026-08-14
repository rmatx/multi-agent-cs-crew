# Frontend Epic — NovaMart Support MVP

Detailed contract: **`frontend-functional-spec.md`** (repo root). Not duplicated here.

## Built (Sprint 1 vertical slice)

- `packages/shared/src/dto.ts` — frozen DTOs copied verbatim from SAD §4 (`ChatRequest`,
  `StreamEvent`, `ReasonCode`, `EscalationPackage`) + tool-result/temporal summary shapes.
  Every other module imports these; none restate them.
- `app/page.tsx` + `app/page.module.css` — single chat column: identity bar (orderId/userId,
  trace toggle), message list with incremental tokens, results area, composer. Send disabled
  while a turn is in flight. CSS modules (Tailwind is not on the approved library list).
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
reported `false`), `GET /api/conversations/:id/trace`. **Money tools: never.**

## Verification run

`npx tsc --noEmit` clean · `next build` clean · dev server + `curl POST /api/chat` for order
ids 1, 46101, 99999999, and a no-identity request. With `AS_OF_DATE=2026-08-13`,
`shiftDays=589`; order 1 streamed `2025-08-13`, order 46101 streamed `2026-08-13 (today)` —
shifted, not 2024. Fixture byte-identical after the run.

## Audit

| Field | Value |
| ----- | ----- |
| Persona id | `frontend-eng` |
| Action | `*develop-fe`, `*style-ui`, `*document-frontend` |
| Timestamp | 2026-08-13 |
| Resolved runtime | `claude-agent-sdk` |
| Open Questions | Tracked in `frontend-functional-spec.md` (notably the `duckdb` → `@duckdb/node-api` package substitution) |
