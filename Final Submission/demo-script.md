# NovaMart demo script

**Total: ~4:30.** Bullets, not prose — say them in your own words.

**URL:** https://multi-agent-cs-crew-production.up.railway.app/final
**Password:** not written down here — this file is in a public repo. It is the value of
`FINAL_DEMO_PASSWORD` in `.env.local` and in Railway. Any username works.

> Timings below are measured against the deployed app, not estimated.
> Resolved turn **13–16s**. Escalated turn **24–32s** — re-measured 10 Sep and the escalation
> path has drifted slower, so budget for the top of that range, not the bottom.
> Two turns ≈ **40–48s** of model time. First turn after a restart is slower still (~32s).

---

## Before you start (do this, not on camera)

- [ ] Open the URL **5 minutes early** — cold start is ~15s, and you don't want that on screen.
- [ ] Authenticate once so the password prompt is already behind you.
- [ ] **Do not push to `main` beforehand.** A deploy swap kills in-flight requests — it produced a
      502 during rehearsal. Let it settle if you have pushed.
- [ ] Run one throwaway turn to warm it, then press **Reset**.
- [ ] **Press Reset between every scenario.** Not cosmetic: two scenarios asking the same question
      with different order ids in ONE conversation makes the coordinator stop and ask *which* order
      you mean — `needs_input`, not the escalation you came to show. Correct behaviour, wrong
      moment. It broke a recording take before Reset was added between turns.
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

### Turn 2 — "Return, just outside" (order 42319) · ~25–32s  ← **the moment**

- Same question. Same specialist. **Order is 15 days old instead of 12 — three days.**
- Narrate the handoff as it happens — this is the HITL moment, and it's visible:
  - *"Returns advisor · checking NovaMart policy"* → *"Escalation · writing the handoff"*
  - crew strip hands **Returns advisor → Escalation**
  - trace: **2 hops · 5 tool calls**, now including `create_ticket_stub` and
    `format_handoff_summary`
- Result: **escalated**, with a real ticket id (`STUB-…`) and reason `restricted_action`.
- **This one is not guaranteed.** Measured roughly 6 times in 7. Occasionally the returns advisor
  answers and *offers* to escalate instead — a `resolved` turn, which is defensible but not the
  beat you want. If it happens: press Reset and run it again, or move straight to **"Refund
  request"**, which escalates structurally because no refund tool exists and has never varied.
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

## Q&A — the four they will ask

### 1 · Why Crew rather than Flow?

- **Reframe first, briefly.** That's CrewAI vocabulary; this runs on the Claude Agent SDK. The
  real question is *who decides which specialist handles a turn* — the agents, or your code.
- **I built both and shipped them behind one interface.** `TurnEngine` has two implementations:
  `deterministic` (a coded pipeline — Flow-shaped) and `sdk` (coordinator + specialists —
  Crew-shaped). Same wire contract, same escalation guarantee. Selected **per request**.
- **Why crew for the real path:** the variable part is intent. You cannot know whether *"can I
  still return this"* needs order data, policy, or both until you read it. A Flow would need a
  classifier at the front — at which point you have built a crew with extra steps.
- **Why the crew still has Flow-shaped rails:** max 4 hops, counted by the runtime and not
  self-reported; one specialist per turn; specialists cannot delegate at all because the `Agent`
  tool is absent from their tool list. A crew that cannot wander.
- **The part worth landing:** the deterministic engine is the *default*, and it is what the public
  URL runs. Same answers for the demo path, no key, no spend. Two engines behind one contract was
  the architecture decision — not Crew *or* Flow.

### 2 · Where does a human approve or override?

- **Be precise: today it is hand-off, not approval — because there is nothing to approve.** No
  refund, cancel or payment tool exists anywhere in the process, so the crew cannot take an action
  a human would need to sign off. The boundary is structural, not procedural.
- **Seven reason codes route a turn to a person** (`lib/status.ts`): `payment_or_refund`,
  `restricted_action`, `customer_requested_human`, `ungrounded`, `low_confidence`,
  `repeat_failure`, `high_severity`.
- **The customer's own override** is the "Talk to a human" button — always visible, never buried,
  and it routes through the *same* escalation path rather than a second mechanism that could
  disagree with the first.
- **What the human receives** is a ticket stub plus a handoff packet: the question, what was tried,
  what was found, the reason code. Shown in the demo.
- **What does not exist: approve-before-act.** That arrives with Phase 2 `F-WRITE-01` — the first
  feature that needs a human in the loop by design rather than as a fallback.
- CSAT (1–5) is a customer *signal*, not an override. Don't oversell it.

### 3 · What breaks first at 10×?

Answer in order, and lead with the one that already happened.

1. **Cost — and I have the receipt.** Running the 23-scenario experiment on 10 Sep exhausted the
   account's credit mid-run; turns started failing in two seconds. There is no per-conversation or
   per-tenant budget cap. At 10× this is the first wall, not a theoretical one.
2. **The guard against that does not survive scaling.** The rate limiter is an in-memory `Map`,
   per process, keyed on client IP. `numReplicas: 1` today — add a second replica and the effective
   limit silently doubles. The thing protecting spend is the thing horizontal scaling breaks first.
3. **Latency goes before throughput.** p95 is **30.4s at single-user**, already missing the PRD's
   <30s target. A second hop roughly doubles wall clock (order-specialist alone is p95 28.6s). The
   ≥5-concurrent half of the target **has never been exercised** — say that rather than guess.
4. **Disk, quietly.** Trace JSONL per conversation on one volume, pruned by a *manual* script.
5. **What probably doesn't break:** SQLite has WAL on so reads never block a turn's writes, and
   DuckDB is read-only. The stores are not the bottleneck; the model calls and the wallet are.

### 4 · What would you build in Phase 2?

- **Harden before building, and it is already written down as accepted risk.** SEC-01/SEC-02:
  there is no authentication, and order ids are sequential integers. That is the gate before real
  customer data — not a Dockerfile problem.
- **Then `F-WRITE-01`** — refund and cancel write APIs. Interesting precisely because it is the
  first feature that *requires* the approve-before-act loop question 2 says does not exist yet.
- **Two new items from this week's observability work**, both honest additions:
  - **Token and cost attribution.** There are currently *zero* LLM spans — traces are built from
    hop and tool records, so cost dashboards have nothing to populate and latency cannot be split
    between model time and tool time.
  - **Make a failed turn distinguishable from a handoff.** A dead turn currently reports
    `escalated`, which is right for the customer and a lie to the dashboard.
- Also on the PRD's P2 list, lower: `F-PROD-DB-01`, `F-OMNI-01`, `F-ZENDESK-01`, `F-COP-01`,
  `F-ANALYTICS-01`.

### Shorter ones

| They ask | You say |
|---|---|
| "How do you stop hallucination?" | Grounding guard + citations. Every fact traces to a tool result; ungrounded answers escalate. DEF-14 is that gate firing too eagerly — I kept it. |
| "Why not one big agent?" | Tool permissions. Least-privilege per specialist is only meaningful if the roles are separate. |
| "What's the latency?" | 13–16s resolved, 24–32s escalated. p95 30.4s single-user. Concurrency untested — that's honest, not hidden. |
| "Is this real data?" | Real schema, synthetic fixture. Dates shift onto today's calendar so "12 days ago" stays true. |
| "What did the framework do?" | AAMAD drove the *build* — nine personas, gated phases. Different harness from the Agent SDK crew inside the app. See the two-harness diagram. |
| "Cost?" | Public URL runs the keyless engine, so a stranger can't spend my key. Crew runs only behind the password. |
| "How do you know it still works?" | The run sheet is an Arize golden dataset; an experiment replays all 23 against the deployed crew. Last run: 88% status match, 94% specialist match. |

## If the demo breaks

1. **Don't debug on camera.** One sentence: "Deployed demo, live model call — let me show the capture."
2. Play `Final Submission/NovaMart-demo-60s.mp4` — it is this exact demo, already recorded.
3. Keep narrating the same script. The story doesn't depend on the click.
