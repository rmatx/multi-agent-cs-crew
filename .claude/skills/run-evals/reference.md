# Run Evals — Reference

Detail for [SKILL.md](SKILL.md). Read this only when you need the worked example, the calibration procedure, or the anti-patterns.

## Worked example: five-dimension framework

An insurer's system reads a submitted claim, extracts structured fields, summarizes the narrative, and flags fraud review. It must respond within seconds, stay within a per-claim cost ceiling, never leak one claimant's data into another's summary, and never auto-deny a claim.

| Dimension | Metric | Grading method | Reason |
|---|---|---|---|
| Accuracy | Field extraction (claimant, policy number, loss amount, date of loss) | Code-based | Expected values are known; exact/schema match needs no interpretation. |
| Latency | Response time p95 | Code-based | A number checked against a target; no judgment involved. |
| Safety | Summary faithfulness | LLM judge | Whether a narrative fabricates content is interpretive. |
| Safety | No auto-deny action | Code-based | Binary — either a denial was issued or not. |
| Security | No cross-claimant data leakage | Code-based | Scan each summary for identifiers from any other claim in the batch — deterministic. |
| Cost | Per-claim spend | Code-based | Derived from token counts, model tier, and caching; check against a ceiling. |

Two methods can apply to one dimension (Safety here) when the dimension has both a bright-line rule and an interpretive component.

## Judge calibration procedure

An LLM judge is itself a system that can be wrong, and an uncalibrated judge produces confident scores that look trustworthy without being accurate — worse than no automated grade at all.

1. Assemble a human-labeled sample (10-30 items minimum, covering each failure-mode category).
2. Run the judge against that sample using the same prompt/rubric intended for full-suite use.
3. Compare judge verdicts to human labels; compute agreement rate.
4. If agreement is low on a category, revise the rubric (more concrete criteria, constrained verdict labels) and re-run before trusting the judge on the full dataset.
5. Re-calibrate whenever the judge model, rubric, or system prompt changes.

Grade with a model different from the one under test to avoid self-preference bias.

## Anti-patterns

### Unrepresentative dataset (the contract-review postmortem)

A team built a contract review assistant, tested it against ten contracts they knew well, declared it ready, and shipped. Two weeks later it failed on a class of contracts — non-standard obligation structures — never represented in the ten. The eval suite existed and passed the whole time; it was measuring the wrong population.

Lesson: build the golden dataset from the input distribution production will see, not from convenient or already-familiar examples. Include documents with missing fields, unusual formatting, and non-standard layouts.

### Stale eval after a prompt change

A team revised a summarization prompt but did not update the eval set. The suite kept passing because its expected outputs still reflected the old prompt's behavior. Two days after the swap, field reports showed legal sentences being truncated in production.

Lesson: every change to the system — model swap, prompt revision, retrieval change — should be accompanied by a review of whether the eval set still reflects the behavior being measured. An eval suite that is present but out of date is worse than no eval suite, because it creates false confidence.

### The 50-session false winner

A team compared 50 sessions of a new system-prompt version against 50 of the old, saw 68% vs. 62% task success, and shipped. Two weeks later the new version had settled at 61% — the apparent 6-point gain was noise. Three compounding problems: the sample was too small for a 6-point difference on a high-variance metric, the input distribution wasn't controlled between the two groups, and the primary metric was chosen after seeing which one moved favorably.

Lesson: pre-specify the primary metric before running a comparison, size the sample to the expected effect and required confidence, and use shadow testing instead of a live split when a single bad output carries too much risk to expose to real users.
