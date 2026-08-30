# docs/

## Reference manuals

| File | What it is |
|------|-----------|
| [`AGENTS.md`](AGENTS.md) | Every agent in the repo — the 9 AAMAD build personas and the 6 NovaMart runtime agents, with tools, allowlists and guardrails |
| [`PROJECT-CONTEXT.md`](PROJECT-CONTEXT.md) | What each `project-context/` artifact is, who owns it, and which ones gate a phase |
| [`diagrams/`](diagrams/) | Editorial diagrams, checked in as `.html` (source) and `.svg` (for embedding) |

Both manuals describe the code and artifacts as they exist. When the code moves, run
`/sync-docs` for `project-context/`, and re-check these two by hand.

---

# Presentation artifacts

Derived communication artifacts. **Not authoritative** — `project-context/1.define/`
holds the source of truth. If a slide and the PRD disagree, the PRD wins.

| File | What it is | Regenerate |
|------|-----------|------------|
| `novamart-prd-scope.pptx` | 9-slide executive scope review. Frames the MVP (P0) boundary against P1 / P2 / OUT. | `node scripts/build-scope-deck.js docs/novamart-prd-scope.pptx` |

## Regenerating

```bash
npm install pptxgenjs          # only dependency
node scripts/build-scope-deck.js docs/novamart-prd-scope.pptx
```

To re-render for visual review (requires LibreOffice + poppler):

```bash
soffice --headless --convert-to pdf docs/novamart-prd-scope.pptx
pdftoppm -jpeg -r 110 novamart-prd-scope.pdf slide
```

## Keeping it honest

The deck hard-codes content copied from `prd.md`. When the PRD changes, the deck does
not follow automatically. Two checks worth re-running after any PRD edit:

```bash
# 1. Do the deck's feature IDs still match the PRD's P0 list exactly?
python -m markitdown docs/novamart-prd-scope.pptx | grep -oE "F-[A-Z]+-01" | sort -u > /tmp/deck.txt
grep -oE "^##### F-[A-Z]+-01" project-context/1.define/prd.md | sed 's/##### //' | sort -u > /tmp/prd.txt
diff /tmp/prd.txt /tmp/deck.txt

# 2. Any leftover placeholder text?
python -m markitdown docs/novamart-prd-scope.pptx | grep -iE "xxxx|lorem|ipsum|placeholder"
```

## Design note

Slide titles use Georgia, which has **oldstyle (text) figures** — digits sit at x-height.
That renders `P0` as `Po`, which is unreadable for a deck whose entire subject is the P0
boundary. All numerals and any string containing a feature tier therefore use Calibri.
Keep that rule if you edit the generator.
