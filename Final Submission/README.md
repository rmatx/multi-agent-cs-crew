# Final Submission

Everything needed to present, review, or test the NovaMart multi-agent support crew.

**Live:** https://multi-agent-cs-crew-production.up.railway.app/final
The reviewer build is password-protected — the password is the value of `FINAL_DEMO_PASSWORD`
(Railway / `.env.local`), deliberately not written down in this public repo. Any username works.
The 23-scenario test workbook downloads from that page.

| File | What it is |
|---|---|
| `NovaMart-demo-60s.mp4` | **60-second recording of the live demo** — one question asked twice, three days apart: resolved with citations, then handed to a human with a ticket. A single unedited take against the deployed app; the pauses are real model latency. Doubles as the fallback if the live demo fails. |
| `NovaMart-Demo-Deck.pptx` | 8-slide demo deck. **The narration is in the speaker notes** — present from the notes pane. |
| `demo-script.md` | The same script as bullets, with measured timings, a pre-flight checklist, likely Q&A, and a break-glass procedure. |
| `architecture.html` | Runtime architecture — the path a customer question travels, per-request engine selection, grounding sources, observability. |
| `two-harnesses.html` | The distinction reviewers most often conflate: AAMAD (the **build** harness, which does not ship) vs the Claude Agent SDK (the **runtime** harness, which does), and the one-way adapter between them. |
| `ci-pipeline.html` | From a commit to confidence — what runs on every push, what needs an API key, what it produces. |

The three diagrams are self-contained interactive HTML: open in any browser, no server. Each has
guided views (top of the page), click-to-trace, light/dark, and PNG/SVG export. `two-harnesses.html`
additionally links every node to its source on GitHub, pinned to a commit so the links keep working.

## Where these come from

These are **outputs**, not sources. Edit the source and regenerate; never hand-edit a file here, or
the two disagree and the generated file wins by accident.

| Output | Source | Regenerate with |
|---|---|---|
| `NovaMart-demo-60s.mp4` | `week5/assets/demo-record.js` | `npm i playwright && FINAL_DEMO_PASSWORD=… node week5/assets/demo-record.js out/`, then ffmpeg to mp4 |
| `NovaMart-Demo-Deck.pptx` | `week5/assets/demo-deck.js` | `npm i pptxgenjs && node week5/assets/demo-deck.js "Final Submission/NovaMart-Demo-Deck.pptx"` |
| `architecture.html` | `week5/assets/architecture.json` | archify `deliver architecture` |
| `two-harnesses.html` | `week5/assets/harnesses.json` | archify `deliver architecture` |
| `ci-pipeline.html` | `week5/assets/pipeline.json` | archify `deliver workflow` |

The same specs also render into `week5/assets/`, which `week5/submission.html` embeds. Both copies
are generated from one spec, so they cannot drift — but if you change a spec, regenerate **both**.

## Deeper material, not duplicated here

- `project-context/1.define/` — MRD, PRD, SAD (19 ADRs)
- `project-context/2.build/` — backend, frontend, integration, QA, security, evals
- `project-context/3.deliver/` — deploy runbook and user guide
- `docs/novamart-demo-runsheet.xlsx` — the 23-scenario test workbook
- `week5/NovaMart-Week5-Submission.pdf` — the Week 5 write-up
