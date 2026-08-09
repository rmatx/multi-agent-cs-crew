# Define-phase quality gate
## Multi-Agent Customer Support Crew for NovaMart

**Date**: 2026-08-08  
**Personas**: `@product-mgr` (MRD/PRD), `@system-arch` (SAD)  
**Status**: **PASS — FINAL-FOR-BUILD**

---

## Checklist

| Criterion | Result |
|-----------|--------|
| `mrd.md`, `prd.md`, `sad.md` in `project-context/1.define/` | Pass |
| Requirements specific & testable (AC IDs, thresholds, enums) | Pass |
| Success criteria measurable & tied to user value | Pass (PRD §7) |
| MRD → PRD traceability (pain ↔ feature matrix) | Pass |
| SAD supports all critical PRD flows | Pass (SAD critical-flow table) |
| Assumptions under-specified? | Closed via ADR-09…13 + PRD OQ closure |
| Scope realistic for Capstone | Pass (P0 freeze; P2/OUT excluded) |
| Stack feasible (`claude-agent-sdk`, TS, Next BFF, DuckDB RO) | Pass |
| `AAMAD_TARGET_RUNTIME=claude-agent-sdk` recorded | Pass |
| Blocking open questions | **None** |

---

## Capstone commitment (one paragraph)

We are building a **customer-facing multi-agent support chat** for NovaMart: Triage + FAQ/Order/Plus/Returns + Escalation, grounded in **read-only DuckDB** (with **date-shift + `AS_OF_DATE` + demo overlay** so 2024 data stays demo-usable) and an in-repo **policy corpus**, with **SSE streaming**, **operator trace**, and **ticket stubs**. We are **not** building Scenario D analytics, refunds, omnichannel, or a production helpdesk clone.

---

## Review findings (addressed)

### @product-mgr on MRD/PRD

| Finding | Action |
|---------|--------|
| DuckDB marked “optional” in MRD while PRD said P0 | MRD locked to P0 |
| Vague “relevance threshold” | Locked **0.55** + keyword/section search |
| `app_issue` category ambiguous | Locked **`other`** |
| `account_question` routing ambiguous | Mutation → escalate; FAQ otherwise |
| Language python vs cursor-sdk | Locked **typescript**; config updated |
| Open questions blocking CI | Fixture-copy strategy locked |

### @system-arch on SAD vs PRD

| Finding | Action |
|---------|--------|
| SSE vs NDJSON under-specified | **SSE** only (ADR-04) |
| BFF vs separate API open | **Next BFF** (ADR-09) |
| Session store tech open | **SQLite** (ADR-10) |
| Critical flow coverage not explicit | Added coverage table |
| support_tickets DuckDB optional ambiguity | Removed from MVP tool surface |
| 2024 DuckDB dates break 14-day / Plus demos | **F-TIME-01 / ADR-14**: shift + `AS_OF_DATE` + overlay |

---

---

## Runtime retrofit (2026-08-08)

Define-phase artifacts were authored in Cursor with `AAMAD_TARGET_RUNTIME=cursor-sdk`. The
project moved to Claude Code as the sole authoring IDE, and the target runtime was changed
to `claude-agent-sdk` to match.

| Item | Before | After |
|------|--------|-------|
| Target runtime | `cursor-sdk` | `claude-agent-sdk` |
| Adapter rule | `.cursor/rules/adapter-cursor-sdk.mdc` | `.claude/rules/adapter-claude-agent-sdk.md` |
| Runtime SDK key | `CURSOR_SDK_API_KEY` | `ANTHROPIC_API_KEY` |
| Project config | absent (referenced but never committed) | `aamad.config.yml` created |

**Unaffected by the change**: ADR-01 (TypeScript + Node LTS), ADR-02/09 (Next.js App Router
BFF), ADR-03 (Triage coordinator + specialists — both SDKs use coordinator-delegates-to-
specialist with typed tools), ADR-05/06/10/12/14 (data, session, CI, temporal layer). No
requirement, acceptance criterion, or flow changed. Historical review findings above are
left as originally recorded.

---

## Audit

- Personas: `product-mgr`, `system-arch`  
- Action: Define quality pass / finalize  
- Runtime: `claude-agent-sdk` (retrofitted 2026-08-08 from `cursor-sdk`)  
- IDE: Claude Code (retrofitted from Cursor)
