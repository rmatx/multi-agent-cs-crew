# AAMAD Framework Rules

This project uses the AAMAD multi-agent development framework.
All rules are loaded from `.claude/rules/`.

## Rule Files
- [aamad-core](.claude/rules/aamad-core.md)
- [development-workflow](.claude/rules/development-workflow.md)
- [epics-index](.claude/rules/epics-index.md)
- [delivery-workflow](.claude/rules/delivery-workflow.md)
- [adapter-registry](.claude/rules/adapter-registry.md)
- [adapter-claude-agent-sdk](.claude/rules/adapter-claude-agent-sdk.md)

## Active runtime

`AAMAD_TARGET_RUNTIME=claude-agent-sdk` (`aamad.config.yml` → `runtime.target`).

Only the matching adapter rule is loaded. The `crewai` and `cursor-sdk` adapter files remain
on disk under `.claude/rules/` as framework artifacts but are **not active** and must not be
followed — loading them put two conflicting runtime contracts in context at once. If the
runtime target ever changes, swap the line above rather than adding to it.

---

For detailed agent/epic/action mapping, see `.claude/rules/epics-index.md`.