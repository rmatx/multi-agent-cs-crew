# NovaMart demo script

**Total: ~4:30.** Bullets, not prose — say them in your own words.

**URL:** https://multi-agent-cs-crew-production.up.railway.app/final
**Password:** not written down here — this file is in a public repo. It is the value of
`FINAL_DEMO_PASSWORD` in `.env.local` and in Railway. Any username works.

> Timings below are measured against the deployed app, not estimated.
> Resolved turn **13–15s**. Escalated turn **24–26s**. Two turns ≈ **40s** of model time.

---

## Before you start (do this, not on camera)

- [ ] Open the URL **5 minutes early** — cold start is ~15s, and you don't want that on screen.
- [ ] Authenticate once so the password prompt is already behind you.
- [ ] **Do not push to `main` beforehand.** A deploy swap kills in-flight requests — it produced a
      502 during rehearsal. Let it settle if you have pushed.
- [ ] Run one throwaway turn to warm it, then press **Reset**.
- [ ] Trace panel open, scenario picker visible. Zoom browser to ~125% so the trace is readable.
- [ ] Fallback ready in a second tab: **`Final Submission/NovaMart-demo-60s.mp4`** (60s, the
      same two turns, unedited). `week5/assets/demo-capture.pdf` is the backup to the backup.

---

## 1 · Problem — 30s

- Retail support inbox: **order status, returns, membership**. High volume, low complexity, a
  human reads every one.
- The tickets that hurt aren't hard, they're **repetitive and time-sensitive** — "where is it",
  "can I still return this".
- Two failure modes, and they're opposite:
  - a bot that **invents** an answer about someone's money
  - a bot that **escalates everything** and saves nobody any time
- So the bar isn't "can an LLM answer this". It's **"can it know when it's not allowed to."**

## 2 · Approach — 45s

- **Claude Agent SDK**, coordinator + specialists. `triage-router` classifies and delegates; it is
  the only agent the customer ever hears — one voice by construction.
- **Five specialists**: order, returns, policy, membership, escalation. One per turn, max 4 hops.
- **Nine tools behind an in-process MCP server** — real reads against DuckDB and a policy corpus.
  Every customer-facing fact traces to a tool result.
- The architectural choice worth naming (SAD §2): **there is no refund tool, no cancel tool, no
  payment tool anywhere in the process.**
  - Not "the prompt says don't" — **the capability does not exist**.
  - Four independent layers: nothing bound · a startup assertion that throws · a CI test that
    fails when a tool is *added* · a runtime hook that denies.
- Same reason specialists can't delegate: the `Agent` tool is **absent from their tool list**, not
  forbidden in prose. A prompt injection can't talk its way into a tool that was never bound.

## 3 · Live demo — 2:30

> One scenario, two turns, and the contrast between them is the whole point.
> Pick both from the **scenario picker** — say out loud that it only fills the form, you still press Run.

### Turn 1 — "Return, inside the window" (order 43004) · ~14s

- Press Run. **Narrate the wait — the UI is doing the work for you:**
  - chat column: *"Returns advisor · checking NovaMart policy"*
  - crew strip lights **Returns advisor**
  - trace counts up: *1 hop · 3 tool calls*
- Result: **resolved.** Order placed, inside the 14-day window.
- Point at **Sources**: `duckdb:orders:43004`, `duckdb:order_items:43004`,
  `policy:returns#return-window`.
  - "It didn't recall the return policy. It read it, and it'll tell you which section."

### Turn 2 — "Return, just outside" (order 42319) · ~25s  ← **the moment**

- Same question. Same specialist. **Order is 15 days old instead of 12 — three days.**
- Narrate the handoff as it happens — this is the HITL moment, and it's visible:
  - *"Returns advisor · checking NovaMart policy"* → *"Escalation · writing the handoff"*
  - crew strip hands **Returns advisor → Escalation**
  - trace: **2 hops · 5 tool calls**, now including `create_ticket_stub` and
    `format_handoff_summary`
- Result: **escalated**, with a real ticket id (`STUB-…`) and reason `restricted_action`.
- Open the **handoff packet** — what the human receives: the question, what was tried, what was found.
- **The line to land:**
  > "Three days apart, opposite answers. It didn't get more confident as it got closer to the
  > boundary — it stopped. That's the behaviour I was actually building for."

### If you have 20 spare seconds

- Click **"Refund request"**. It escalates, and the reason is that no refund tool exists to call.
- Or point at **`/`** — same app, crew switched off, keyless engine. Anyone can open it; the live
  crew runs only behind this password.

## 4 · What I learned — 30s

**Pick one. The honest one:**

- I shipped a demo-mode feature flag that the deployed container **could never read.**
- `NEXT_PUBLIC_*` is **inlined by the compiler at build time**. Setting it in the platform's
  variable table changes nothing — the built bundle never looks.
- So the crew strip and scenario picker were "missing in production" while being **present in every
  build**. I'd been debugging the deployment; the bug was in what "runtime config" means.
- Fix was a server-read var reported through `/api/health` — the app now **tells you** which
  surface it's serving instead of my having to guess.
- Wider lesson: **an agent system's config has to be inspectable at runtime**, or you're debugging
  by redeploy.

*(Alternate, if the room is more agent-design than infra: prompts can't remove capabilities.
I wrote careful instructions telling specialists not to delegate — then realised the only version
that survives an injection is not giving them the tool.)*

## 5 · What's next — 15s

- **Harden first, and it's already written down as accepted risk:** there is no authentication.
  Any caller can read any customer's order, and **order ids are sequential integers** (SEC-01/02).
  That's the gate before real data — not a Dockerfile problem.
- **Then Phase 2 from the PRD:** `F-WRITE-01` — refund/cancel write APIs. The interesting part is
  that it's the *first* feature that needs a human in the loop by design rather than by fallback.
- Also open and honest: **DEF-14**, one accepted defect — a correct policy retrieval scored under
  the grounding gate and escalated. It fails cautiously, which is the right direction to fail.

---

## Q&A — likely questions

| They ask | You say |
|---|---|
| "How do you stop hallucination?" | Grounding guard + citations. Every fact traces to a tool result; ungrounded answers escalate. DEF-14 is that gate firing too eagerly — I kept it. |
| "Why not one big agent?" | Tool permissions. Least-privilege per specialist is only meaningful if the roles are separate. |
| "What's the latency?" | 13–15s resolved, ~25s escalated. p95 measured 30.4s single-user. Concurrency untested — that's honest, not hidden. |
| "Is this real data?" | Real schema, synthetic fixture. Dates shift onto today's calendar so "12 days ago" stays true whenever you run it. |
| "What did the framework do?" | AAMAD drove the *build* — nine personas, gated phases. Different harness from the Agent SDK crew inside the app. See the two-harness diagram. |
| "Cost?" | Public URL runs the keyless engine, so a stranger can't spend my key. Crew runs only behind the password. |

## If the demo breaks

1. **Don't debug on camera.** One sentence: "Deployed demo, live model call — let me show the capture."
2. Play `Final Submission/NovaMart-demo-60s.mp4` — it is this exact demo, already recorded.
3. Keep narrating the same script. The story doesn't depend on the click.
