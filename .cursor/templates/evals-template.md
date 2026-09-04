# AAMAD Evaluation Strategy Template

## Context & Instructions
Define and record the evaluation strategy and results for the MVP built in this project.
Derive success criteria from the SAD evaluation criteria table (section 9) when present, the PRD, and `system-description.md` / user-story acceptance criteria. When required business context (thresholds, SLA, risk tolerance) is missing, ask the operator per `.cursor/skills/run-evals/SKILL.md` Step 2 rather than inventing values.
Align runtime instrumentation with the active `AAMAD_TARGET_RUNTIME` adapter rule.

## Input Requirements

**PRD**: [REFERENCE `project-context/1.define/prd.md`]
**SAD** (section 9 criteria table, if present): [REFERENCE `project-context/1.define/sad.md`]
**System Description / User Stories** (optional): [REFERENCE IF PRESENT]
**backend.md / integration.md**: [REFERENCE]
**Selected Runtime**: [crewai | claude-agent-sdk | cursor-sdk]

## Evaluation Report — Generate All Sections Below

### 1. Eval Strategy

- Behaviors in scope for this eval suite and why
- Dimensions covered (accuracy, latency, safety, security, cost — extend if the PRD requires more)

### 2. Success Criteria and Thresholds

| ID | Dimension | Metric | Threshold | Grading Method | Source |
|----|-----------|--------|-----------|-----------------|--------|
| EC-001 | Accuracy | … | … | Code-based / LLM judge / Human | PRD §x / SAD §9 / Operator answer |

The **Source** column is mandatory: every threshold must trace to a PRD/SAD anchor or to an operator answer recorded under Assumptions. A row with no traceable source is a signal the number was guessed.

### 3. Golden Dataset

- Failure-mode categories covered, with item counts per category
- Adversarial / edge-case coverage
- Provenance: real production-shaped data vs. synthetic, and why

### 4. Grading Methods

- Code-based checks implemented (list files/functions)
- LLM-as-judge rubric(s) used, judge model (different from the model under test), and calibration result (agreement rate vs. human-labeled sample)
- Human-review items, if any, and reviewer process

### 5. Implementation

- Location of eval suite in the repo (e.g. `evals/dataset/`, `evals/checks/`, `evals/judge/`, `evals/run.py`)
- Runtime instrumentation added (trace fields, hooks/callbacks used) per the active adapter rule
- How to re-run the suite

### 6. Results

- Per-category pass/fail or score breakdown (not just an aggregate mean)
- Dimensions passing vs. failing threshold
- Known gaps and whether they block Deliver or are explicitly accepted

### 7. Production Monitoring Recommendations

Handoff to `@devops.eng` for the Deliver stage:

- **Request-level trace fields**: model/version, input/output token counts, latency, stop reason, tool calls
- **Dashboard metrics**: cost per request, latency p50/p95, task success rate, error rate by type
- **Threshold alerts**: e.g. cost spike over 150% of 7-day average, latency p95 crossing SLA
- **Change attribution**: how to distinguish model drift, data drift, and model-update effects
- **Business-KPI translation**: map each technical metric above to the business metric it drives

### 8. Future Work

- Deferred eval coverage (e.g. multi-turn conversation evals, live A/B or shadow testing) not implemented in this MVP pass

## Sources

- PRD / SAD / system-description / user-story paths used

## Assumptions

- Thresholds and scope decisions supplied by the operator during the Step 2 gap check, attributed as such

## Open Questions

- Any gap-check item the operator declined to specify, with the placeholder value used in its place

## Audit

- Timestamp, persona id (`qa-eng`), action (`run-evals`), resolved `AAMAD_TARGET_RUNTIME`
