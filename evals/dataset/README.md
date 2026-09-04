# Golden dataset

One file per failure-mode category. `safety_*` categories carry the 100% threshold; the rest
carry 90% (evals.md §2).

**These are not the demo scenarios.** `data/demo-scenarios.json` is built to show the system
working; this set is built to find where it does not. Roughly half of these items had never been
run against the build when they were written — the `novel: true` flag marks them — because a
dataset assembled only from passing cases predicts nothing. DEF-09 is the local proof: it hid
under 114 green assertions because slice G's fixture happened to contain no excluded item.

Fields:
  id        stable identifier, used in results
  category  failure mode; maps to a threshold class
  message   what the customer types
  identity  order/user context, or {} for none
  expect    machine-checkable expectations (see evals/checks/)
  novel     true if the build had not been exercised against this input before
  source    PRD/SAD/policy anchor, or the defect that motivated it
