# Multi-Agent Customer Support Crew (NovaMart)

Capstone project: a customer-facing multi-agent support chat crew, built with the
[AAMAD](https://pypi.org/project/aamad/) multi-agent development framework.

- **Authoring IDE**: Claude Code
- **Target runtime**: `claude-agent-sdk` (TypeScript / Node LTS)
- **Phase**: 1 (Define) complete — `FINAL-FOR-BUILD`. Phase 2 (Build) in progress — the
  Sprint 1 vertical slice runs.

## Run it locally

Requires Node LTS and npm. No API key: this slice composes its answer from the tool
result rather than calling a model, so it runs offline and deterministically.

```bash
npm install
npm run dev          # http://localhost:3000
```

The app falls back to the committed `data/fixtures/novamart_ci.duckdb` (3.2 MB, the five
MVP-read tables with every row). Nothing else is required to start.

Type an order number, ask "Where is my order?", and press **Run**.

| Order id | What you should see |
| ---: | --- |
| `46101` | Placed today — raw date in the database is `2025-01-01` |
| `42776` | Placed 13 days ago — inside the 14-day return window |
| `1` | Placed about a year ago — correctly outside the window |
| `99999999` | Not found, `needs input` — no invented tracking number |

Those dates move with the clock. To pin them, set the as-of date:

```bash
AS_OF_DATE=2026-08-13 npm run dev
```

Every eval must pin it too — with `asOf` defaulting to today, the date shift grows by one
day per day and absolute expectations rot silently.

Other useful commands:

```bash
npm run typecheck                        # strict TypeScript
npm run build && npm start               # production build
NOVAMART_DUCKDB_PATH=/path/to/full.duckdb npm run dev   # use the 151 MB practice DB
```

See [`frontend-functional-spec.md`](frontend-functional-spec.md) for the workflow contract
and [`docs/novamart-demo-90s.mp4`](docs/novamart-demo-90s.mp4) for a 90-second narrated
walkthrough. Stills of the same path — input, result, not-found — are in
[`docs/screenshots/`](docs/screenshots/).

![Grounded order status](docs/screenshots/02-result.png)

## Where the agent runtime connects next

This slice deliberately has **no model call**. `app/api/chat/route.ts` looks the order up
through the repository port and composes the reply deterministically. That single function
is the seam.

The target runtime is **`claude-agent-sdk`** — not CrewAI. `aamad.config.yml` sets
`runtime.target`, and `.claude/rules/adapter-crewai.md` is an inactive framework artifact
that must not be followed. Wiring it up means:

1. `triage-router` becomes the main agent; the five specialists become `AgentDefinition`
   entries in `ClaudeAgentOptions.agents`, invoked through the `Agent` tool (ADR-03).
2. The current in-route lookup becomes the `get_order` / `get_order_items` **tools**, bound
   per agent by allowlist. The repository port and `DateShiftMapper` stay exactly as they
   are — agents never see a raw date.
3. Model tokens replace the composed string on the same `StreamEvent` stream, so the
   frozen DTO contract and the client FSM need no change.

Nothing in `packages/shared/src/dto.ts` should have to change when that lands. If it does,
the contract-freeze gate in the SAD has been breached and it belongs in `integration.md`.

## Layout

```
project-context/
  1.define/     MRD, PRD, SAD, quality gate     <- complete
  2.build/      backend, frontend, integration, qa, security
  3.deliver/    deploy, user guide
.claude/
  agents/       AAMAD personas (project-mgr, backend-eng, ...)
  rules/        AAMAD core + runtime adapter rules
  commands/     /phase-1-define, /sync-docs
.cursor/
  templates/    AAMAD artifact templates (shipped for every IDE target)
aamad.config.yml   project preferences — personas load this at start
```

| Artifact | Path |
|----------|------|
| Market Research | `project-context/1.define/mrd.md` |
| Product Requirements | `project-context/1.define/prd.md` |
| System Architecture | `project-context/1.define/sad.md` |
| Quality gate | `project-context/1.define/define-quality-gate.md` |

## Architecture at a glance

Next.js App Router app (UI + BFF route handlers, ADR-09) running a `claude-agent-sdk`
multi-agent runtime. A **Triage** coordinator routes each customer message to one
specialist (FAQ / Order / Plus / Returns), which calls **typed tools** over a read-only
NovaMart DuckDB and an in-repo policy corpus. Restricted or failed paths terminate in
**Escalation**, which writes a ticket stub. Responses stream over SSE (ADR-04).

## Runtime retrofit

Define-phase artifacts were originally authored in Cursor targeting `cursor-sdk`. On
2026-08-08 the project moved to Claude Code and the target runtime changed to
`claude-agent-sdk`. No requirement, acceptance criterion, or architectural flow changed —
see the *Runtime retrofit* section of `project-context/1.define/define-quality-gate.md`
for the full before/after.

## Next step

Phase 2, Module 1 — `@project-mgr` scaffolds the TypeScript/Node app per
`.claude/rules/development-workflow.md`. Run each Build module in a fresh session.
