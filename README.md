# Multi-Agent Customer Support Crew (NovaMart)

Capstone project: a customer-facing multi-agent support chat crew, built with the
[AAMAD](https://pypi.org/project/aamad/) multi-agent development framework.

- **Authoring IDE**: Claude Code
- **Target runtime**: `claude-agent-sdk` (TypeScript / Node LTS)
- **Phase**: 1 (Define) complete — `FINAL-FOR-BUILD`. Phase 2 (Build) not started.

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
