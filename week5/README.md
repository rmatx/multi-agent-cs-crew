# Week 5 submission — NovaMart Support Crew

| File | What |
| --- | --- |
| `NovaMart-Week5-Submission.pdf` | **Hand this in.** 8 pages, all figures embedded. |
| `submission.html` | The source. Open in a browser for links and the interactive diagram. |
| `assets/architecture.html` | Interactive architecture map (archify). Standalone — pan, zoom, four guided views, export. |
| `assets/architecture.json` | The diagram's typed source, validated at `showcase` quality. |
| `assets/demo-returns-boundary.png` | Live capture of the returns boundary, referenced by §1. |
| `assets/demo-capture.pdf` | The operator's own 3-page demo capture, referenced by §1. |
| `assets/architecture.visual-check.*` | Browser evidence for the diagram: receipt, contact sheet, screenshots at 1440×900 and 2048×1320, light and dark. |

## Regenerating

Rebuild the PDF after editing the HTML:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=12000 \
  --print-to-pdf="$PWD/week5/NovaMart-Week5-Submission.pdf" \
  "file://$PWD/week5/submission.html"
```

```bash
npm run observability      # the numbers in §2
npm run evals              # the eval results in §3
npm run demo               # the app the screenshots come from
```

The architecture diagram is rebuilt from its source with the archify skill:

```bash
node ~/.claude/skills/archify/bin/archify.mjs deliver architecture \
  week5/assets/architecture.json week5/assets/architecture.html --quality showcase
```

## A note on the evidence

Every figure in the submission traces to something in the repository rather than to prose:
`project-context/2.build/qa.md` for the test and defect record, `evals.md` for the eval results,
`security.md` for the open findings, and `docs/demo-feedback.md` for what the live demo surfaced.
