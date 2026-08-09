# Market Research Document (MRD)
## Multi-Agent Customer Support Crew for NovaMart

## Context & Instructions

Comprehensive market research for a production-oriented Capstone multi-agent system. Recommendations are evidence-based. Selected runtime (`AAMAD_TARGET_RUNTIME=claude-agent-sdk`) is an implementation choice for Phase 2 Build, not the market thesis.

---

## Research Query Structure

**Primary Focus**: Multi-agent customer support chat crew for NovaMart (fictional mid-stage ecommerce) that triages and resolves routine support intents, with governed escalation to humans.  
**Selected Runtime** (optional for research; required later in Build): `claude-agent-sdk`  
**Stakeholder answers locked for this draft**:

| Decision | Choice |
|----------|--------|
| Capstone intent | (a) Multi-agent **support product** that handles NovaMart customer issues |
| Primary user | **Customers in chat** |
| Data for MVP | **Synthetic chat/policy layer** + **P0 read-only** NovaMart practice DuckDB (see Data Source) |
| Scenario D | Clarified below — **pain validation / domain signal**, not MVP product job |
| Stack (locked with PRD/SAD) | TypeScript / Node + `claude-agent-sdk`; Next.js chat UI |

**Document status**: `FINAL-FOR-BUILD` (quality pass 2026-08-08). Capstone commitment is the customer chat crew below — not Scenario D analytics.

### Data Source — NovaMart practice DuckDB

**Path**: `/Users/rmani/Library/CloudStorage/GoogleDrive-rmanitx@gmail.com/My Drive/ClaudeCode/Maven-Analyst-101/ai-analyst-starter/data/practice/novamart_practice.duckdb`

| Table | Rows (approx) | Capstone use |
|-------|---------------|--------------|
| `users` | 50,000 | Identity / country / device for chat context |
| `orders` | 47,199 | Order Specialist tool (status, totals, Plus order flag) |
| `order_items` | 75,447 | Line-item detail |
| `products` | 500 | Catalog / Plus-eligible |
| `memberships` | 5,513 | Plus trial/monthly/annual lifecycle |
| `support_tickets` | 21,587 | Taxonomy realism; Scenario D signals (`device`, `app_version`) |
| `promotions` | 5 | Policy/FAQ grounding (Welcome10, sales) |
| `sessions` / `events` | 1.4M / 6.5M | **Out of MVP** (analytics-heavy) |
| `experiments` / `experiment_assignments` | 2 / 20k | **Out of MVP** (Scenario menu A/B) |
| `nps_responses` / `calendar` | 8k / 366 | Optional later |

**Ticket category mix (supports pain validation)**: delivery_issue (6,325) · payment_issue (5,767) · product_quality (4,176) · account_issue (3,184) · membership_issue (1,096) · other (1,039).

**App versions on tickets**: includes `3.2.0` (4,085) — aligns with Scenario D spike narrative; many tickets have `app_version` null (web/other).

**Critical schema gap for chat MVP**: `support_tickets` has **no subject/body/transcript** columns — only structured metadata (`category`, `severity`, `status`, `device`, `app_version`, `order_id`). Customer chat utterances and policy text must still be **synthetic / authored** for the crew; DuckDB is the **lookup & tagging** backend, not the conversation corpus.

**MVP data strategy (locked)**:

1. Author synthetic chat scripts + in-repo policy markdown.  
2. **Must** bind read-only tools to DuckDB for `users`, `orders`, `order_items`, `products`, `memberships`.  
3. Ticket stubs write to a **separate** store (never mutate practice DuckDB).  
4. Do **not** require `events` / `sessions` / `experiments` for chat MVP.  
5. CI uses a **copied DuckDB fixture** (or repo-relative path); Google Drive path is for local/dev.  
6. Full prod DB remains post-Capstone.  
7. **Temporal model (locked)**: Practice data is calendar-year **2024**. To keep 14-day returns / Plus trial demos realistic, the read adapter applies a **date shift** (align dataset max date → today by default), supports **`AS_OF_DATE`** for deterministic evals, and may overlay a tiny **demo persona** set with current-relative dates (see PRD/SAD). Never rewrite the course DuckDB in place.

### Scenario D clarification (Capstone menu item D)

| Lens | Meaning |
|------|---------|
| What Scenario D is | An **analytics decision** for the NovaMart pod: *“Is app v3.2.0 the cause of the Android support-ticket spike?”* — owned by Maya/Marcus/Jordan-style stakeholders using `support_tickets` + device/app_version data. |
| What this Capstone is | A **customer-facing multi-agent chat crew** that answers shoppers (order status, Plus/shipping, returns policy, app issues as *tickets*, etc.). |
| How they relate | Scenario D **validates genuine support pain** in the NovaMart world (ticket spikes, severity, device/app_version). The crew may **ingest/classify** “app broken on Android” style intents and tag `app_version` / device on synthetic tickets. |
| What is **out of MVP** | Causal experiment design, A/B significance testing, or a DS dashboard that answers Scenario D for the pod. That can be a later analytics add-on once ticket telemetry exists. |

**Implication for design**: Treat ticket spikes and app-version tags as **domain realism** in synthetic data and triage taxonomy — not as the primary success metric of the chat crew.

---

## Executive Summary

### Market Opportunity

Global AI for customer service is a large, fast-growing category (~USD 12–13B in 2024; forecasts ~23–26% CAGR into the early 2030s), with **retail & ecommerce among the fastest-growing end-use segments**. Mid-stage ecommerce operators like NovaMart face high volumes of repetitive intents (order status, shipping, returns, membership/Plus) while also absorbing **spikes** (e.g., Android ticket surge tied to a release). Industry benchmarks show median AI deflection still only ~40% in many enterprise programs — meaning **resolution quality and hybrid handoff**, not “chatbot theater,” remain the gap.

### Technical Feasibility

A multi-agent crew (specialize → hand off → escalate) is a proven pattern for ecommerce support: triage, policy/FAQ grounding, order/membership lookup, returns guidance, and escalation with full context. Capstone MVP is **technically feasible** with synthetic catalogs/orders/tickets and a chat UI; production DB, payments write-back, and omnichannel are deferred. Runtime target `claude-agent-sdk` fits a TypeScript-first agent + tool-contract Build later; market need does not depend on that choice.

### Recommended Approach

**Go** for Capstone: build a **customer chat MVP** with a named multi-agent crew, synthetic NovaMart data, strict automation vs HITL boundaries, and measurable deflection + CSAT + escalation-quality KPIs. Position differentiation as **role-specialized agents + explicit tool/policy contracts + auditable escalation**, not as another monolithic FAQ bot. Use Scenario D only as **pain evidence and ticket taxonomy realism**.

---

## Detailed Findings by Dimension

### 1. Market Analysis & Opportunity Assessment

#### Key Insights

- Ecommerce support demand is structural: high ticket volume, seasonal peaks (Black Friday / Holiday), and membership programs (NovaMart **Plus**) create recurring “where is my order / free shipping / trial” intents.
- NovaMart-scale fiction (~tens of thousands of users, ~50K orders, ~1M visits in 2024) is a credible mid-stage retailer for which 24/7 chat automation is valuable even before enterprise Zendesk spend.
- Market gap: single-bot assistants often fail on **multi-step** journeys (lookup → policy → action recommendation → escalate with context). Multi-agent specialization addresses that gap.
- Willingness to pay (industry): ecommerce brands already pay for Gorgias / Zendesk / Intercom AI add-ons; Capstone itself is educational/demo, but the **pain and buy-triggers are real**.
- Scenario D’s ticket spike is evidence that **release quality and device-specific defects** drive support load — a crew that classifies and routes those tickets reduces L1 load even when root-cause analytics stay separate.

#### Data Points

| Metric | Value | Notes |
|--------|-------|-------|
| AI for customer service market (2024) | ~USD 12.06B – 13.01B | MarketsandMarkets / Grand View Research ranges |
| Projected (examples) | ~USD 47.8B by 2030 (MnM); ~USD 83.9B by 2033 (GVR) | Different scopes; use as order-of-magnitude |
| CAGR (illustrative) | ~23–26% | Category growth, not Capstone revenue |
| Retail & ecommerce end-use | Fast CAGR cited (~26% in GVR end-use split) | Strong vertical fit |
| Median AI deflection (enterprise programs) | ~41.2% | Far below many vendor 80%+ claims |
| Routine-intent deflection potential | Often 70%+ for WISMO / password-class intents | Capstone should bias MVP to these |
| NovaMart Plus trial→paid | Slipped ~28% → ~22% while signups +~20% | Strategic pressure; support quality can affect membership trust |

#### Target Audience & Personas

| Persona | Who | Goals | Pain / workflow today | MVP relationship |
|---------|-----|-------|----------------------|------------------|
| **P1 Shopper (primary)** | B2C customer on web/app chat | Fast answer on order, shipping, return, Plus | Waits, FAQ loops, repeats order # | Direct user of chat crew |
| **P2 Plus member / trialist** | Trial or paid Plus | Free shipping clarity, exclusives, cancel/renew questions | Confused by trial→paid rules | Priority intents + membership tools |
| **P3 L1 human agent (secondary)** | Internal support (future) | Clear escalations with summary | Re-asks customer; missing context | Receives escalation packages (MVP: stub/simulated) |
| **P4 Ops / PM (observer)** | Maya-style stakeholder | Reduce backlog; protect CSAT during spikes | Ticket floods after releases | Consumes metrics; not chat user |

#### Competitive Landscape (selected)

| Competitor / class | Strengths | Limitations vs multi-agent Capstone thesis |
|--------------------|-----------|---------------------------------------------|
| **Zendesk AI** | Enterprise omnichannel, mature triage/copilot | Heavy; ecommerce actions often need config; attachment/knowledge limits called out by practitioners; cost complexity |
| **Intercom Fin** | Strong conversational AI + handoff | Ecommerce write-actions often need custom connectors; priced for SaaS/engagement stacks |
| **Gorgias** | Ecommerce-native (Shopify etc.), order/return macros | Platform-tied; less general multi-agent research/demo flexibility |
| **Generic single GPT bot** | Fast to demo | Weak grounding, poor tool discipline, brittle multi-step flows, weak audit |
| **DIY scripts / FAQ only** | Cheap | No personalization to order/Plus state; fails on spikes |

#### Business Case (NovaMart Capstone framing)

| Value lever | Hypothesis |
|-------------|------------|
| Deflect routine WISMO / Plus FAQ | Cut synthetic “L1” load 30–50% on in-scope intents |
| Faster first response | Chat crew responds in seconds vs ticket queue |
| Escalation quality | Humans get intent + entities + attempted steps (fewer re-asks) |
| Spike resilience | Classify Android/app_version tickets during “v3.2.0-like” incidents |
| Learning / Capstone ROI | Demonstrable multi-agent architecture with swap-in DB later |

#### Implications

- Size the Capstone MVP around **high-volume, low-risk intents**, not full contact-center replacement.
- Keep **Plus** and **order/return** as first-class domain objects in synthetic data.
- Treat competitors as proof of market, not as features to clone 1:1.

---

### 2. Technical Feasibility & Requirements Analysis

#### Key Insights

- Multi-agent patterns fit support: **router/triage → specialist agents → escalation agent**.
- MVP should use **tools over memory**: order lookup, membership status, policy RAG, ticket create/tag.
- **NovaMart practice DuckDB** is available as the example structured store; chat/policy text remains synthetic (tickets lack body text).
- Design tool interfaces so DuckDB today / other DB later can swap behind the same ports.
- `claude-agent-sdk` (configured) favors explicit tool/runtime contracts, streaming chat UX, and TypeScript/Node packaging in Build — aligned with a chat product.
- Main technical risks: hallucination on policy/refunds, tool errors, latency under multi-agent hops, unsafe “actions.”

#### Recommended MVP agent crew

| Agent | Responsibility | Automation level |
|-------|----------------|------------------|
| **Triage / Router** | Intent, urgency, entity extract (order_id, email, device, app_version) | Full auto |
| **FAQ / Policy** | Grounded answers (shipping, returns window, Plus rules) | Full auto if grounded; else escalate |
| **Order Specialist** | Order status, items, return flags (read-only synthetic) | Full auto read |
| **Membership / Plus Specialist** | Trial vs paid, shipping benefits, plan FAQ | Full auto read |
| **Returns Advisor** | Policy + eligibility guidance; **no money movement in MVP** | Partial — advise only |
| **Escalation / Human Handoff** | Package summary + ticket stub for L1 | Auto package; human simulated |

#### Integration requirements (MVP vs later)

| Integration | MVP | Later (out of scope now) |
|-------------|-----|---------------------------|
| Synthetic chat scripts + policy corpus | Yes | — |
| NovaMart practice DuckDB (read-only lookups) | **P0 required** | Default tool backend; CI fixture copy |
| True prod DB | No | Later |
| Payment / refund execution | No | Maybe |
| Live shipping carriers | No | Maybe |
| Zendesk/Gorgias export | No | Optional |
| Scenario D analytics warehouse | No | Optional telemetry sink |

#### Scalability & infra (Capstone-realistic)

- Bottlenecks: multi-agent fan-out latency; LLM cost per turn; retrieval quality.
- Mitigation: short specialist prompts, cache policy docs, limit tool calls per turn, stream tokens to chat UI.
- Infra MVP: local/dev deploy + simple hosting later; no multi-region requirement for Capstone.

#### Implications

- Design **read-only tools + advise-only returns** for safety.
- Log every tool call and agent handoff for Audit/QA.
- Keep Scenario D fields (`device`, `app_version`, `severity`, `category`) in synthetic tickets for realism.

---

### 3. User Experience & Workflow Analysis

#### Key Insights

- Primary journey is **customer chat**, not internal analytics UI.
- Trust depends on: correct order facts, clear Plus rules, honest “I don’t know / escalate,” and no invented refunds.
- Automation sweet spot: status, policy, Plus FAQ, ticket intake for app bugs.
- HITL required: refunds/chargebacks, legal/safety, abuse, repeated failure, customer requests human, high-severity account issues.

#### User journey (MVP happy path)

1. Customer opens chat → greets + asks for order # or account email (synthetic auth lite).  
2. Triage classifies intent + extracts entities.  
3. Specialist answers with tool-grounded facts + policy citations.  
4. If unresolved or restricted → Escalation agent opens synthetic ticket + shows summary.  
5. Customer rates resolution (CSAT micro-survey).

#### Spike / Scenario D–flavored journey (support product view)

1. Customer: “App crashes on Android after update.”  
2. Triage tags `category=app`, `device=android`, `app_version=3.2.0` (synthetic).  
3. FAQ gives known workarounds if in knowledge base; else escalate with severity.  
4. *Analytics Scenario D remains a separate offline question for the pod using aggregated tickets.*

#### Success metrics (MVP)

| KPI | MVP target (synthetic demo) | Guardrail |
|-----|----------------------------|-----------|
| Containment / deflection on in-scope intents | ≥ 40% of demo scripts | CSAT not collapsing |
| Grounded answer rate (tool/policy cited) | ≥ 90% of auto-resolved | Zero fabricated order totals |
| Escalation package completeness | 100% include intent + entities + steps tried | — |
| First response time | < 5s perceived TTFT | — |
| Unsafe action attempts | 0 refunds/payments executed | Hard block |

#### Adoption factors

- **Enablers**: speed, accurate order status, Plus clarity, easy human ask.  
- **Barriers**: wrong policy, looping, opaque escalation, “AI feel” without facts.

---

### 4. Production & Operations Requirements

#### Key Insights

- Capstone “production-ready” means **operable demo**: logs, traces, config, eval scripts — not full SOC2.
- Security: no real PII; synthetic identities; forbid committed secrets (per `aamad.config.yml`).
- Observability: per-turn agent id, tool I/O, latency, escalation reason codes.
- Cost: dominated by LLM tokens in multi-agent hops — budget demos with capped max steps.

#### Risk assessment (ops)

| Risk | Level | Mitigation |
|------|-------|------------|
| Policy hallucination → wrong return promise | High | Grounding + refuse + escalate |
| Customer thinks refund happened | High | No write tools for money in MVP |
| Latency from agent chain | Medium | Caps, parallel tools where safe |
| Synthetic→prod schema drift later | Medium | Stable tool contracts / ports |
| Scope creep into Scenario D analytics | Medium | Explicit out-of-scope in PRD |

#### Cost structure (directional, Capstone)

| Bucket | MVP |
|--------|-----|
| Dev time | Dominant cost |
| LLM API | Moderate; control with max turns |
| Hosting | Low for demo |
| Human agents | Simulated |

---

### 5. Innovation & Differentiation Analysis

#### Unique value propositions (multi-agent approach)

1. **Specialist crew** instead of one mega-prompt — clearer ownership of order vs Plus vs policy.  
2. **Explicit tool contracts** (claude-agent-sdk-aligned) — lookups are auditable; fewer silent hallucinations.  
3. **Escalation as a first-class agent** — context package quality is a product feature.  
4. **NovaMart-domain fidelity** — Plus trial/paid, promotions calendar awareness (read-only FAQ), app_version tagging for spike realism.  
5. **DB-swap architecture** — synthetic now, NovaMart DB later without rewriting the crew.

#### Emerging tech relevant to Capstone

- Agentic tool-use and multi-agent orchestration  
- RAG over policy  
- Evaluation harnesses for support trajectories  
- Streaming chat UX  

#### Patent / IP

- No Capstone-blocking patent analysis performed; treat as educational build. Monitor vendor ToS for model/API use.

#### Monetization (market context; not Capstone billing)

- Per-resolution / per-seat AI add-on (industry pattern)  
- Capstone itself: portfolio / learning artifact, optional future productization  

#### Implications

- Differentiate on **orchestration + grounding + escalation**, not on claiming better foundation models than Zendesk/Intercom.

---

## Critical Decision Points

### Go / No-Go Factors

| Factor | Status |
|--------|--------|
| Genuine market / NovaMart pain | **Go** — support volume + spikes + Plus complexity |
| Clear primary user | **Go** — customer chat |
| Safe MVP boundary | **Go** — synthetic data; no payment writes |
| Avoid analytics scope trap (Scenario D) | **Go** if kept as context only |
| Prod DB in MVP | **No-Go for MVP** (explicitly deferred) |

### Technical Architecture Choices (research recommendation)

| Choice | Recommendation |
|--------|----------------|
| Runtime (Build) | `claude-agent-sdk` per project config |
| Orchestration | Multi-agent crew with router + specialists + escalation |
| Data | Synthetic NovaMart-shaped entities; port-based repository |
| UI | Customer chat (+ simple debug/trace view for demo) |
| Analytics Scenario D | Out of MVP; optional Phase 3+ |

### Market Positioning

> **For NovaMart shoppers who need fast, accurate help on orders, Plus, and returns, the Multi-Agent Customer Support Crew is a specialized chat team that grounds answers in tools and policies and escalates cleanly — unlike a single FAQ bot that guesses.**

### Resource Requirements (Capstone-shaped)

| Resource | Guidance |
|----------|----------|
| Timeline | Define → Architect → Build MVP chat + synthetic tools → QA eval scripts |
| Team | Solo/small Capstone; personas via AAMAD |
| Budget | LLM API + local/dev infra |

---

## Risk Assessment Matrix

### High Risk

- Hallucinated policies or order facts  
- Implied financial actions without execution layer  
- Scope creep into pod analytics (Scenario D) delaying chat MVP  

### Medium Risk

- Multi-agent latency / cost  
- Weak eval coverage → demo fragility  
- Future prod DB mismatch  

### Low Risk

- Competitor feature parity pressure (Capstone not shipping as SaaS)  
- Brand/UI polish gaps for educational MVP  

---

## Actionable Recommendations

### Immediate next steps (≤ 48 hours)

1. Freeze MVP intent list (WISMO, Plus FAQ, returns policy, app-issue ticket intake, escalate).  
2. Author `system-description.md` + PRD from this MRD (`@product-mgr`).  
3. Decide MVP tool binding: mock repos vs read-only DuckDB for `orders` / `memberships` / `users` / `products`; author synthetic chat + policy corpus (tickets have no body).  

### Short-term (≈ 30 days)

1. SAD/SFS with `@system-arch` for crew + tool contracts.  
2. Build chat MVP + synthetic repositories.  
3. Eval suite: scripted dialogues + grounding checks.  

### Long-term (6–12 months / post-Capstone)

1. Plug NovaMart example/prod DB behind same ports.  
2. Optional: ticket telemetry → Scenario D analytics for the pod.  
3. Consider human-agent copilot mode and limited write actions with approvals.  

---

## Research Quality Notes

- Market figures vary by firm (scope/definition); treat as **ranges**, not Capstone revenue forecasts.  
- NovaMart operational numbers come from the course quick reference (fictional dataset).  
- Competitive limitations synthesize vendor docs and industry commentary; validate before any commercial claims.

---

## Sources

1. NovaMart Quick Reference (AI Analytics for Builders / aianalystlab.ai) — local brief `novamart.pdf`, Week 1 Capstone menu A–F.  
2. Stakeholder decisions in chat (2026-08-07): Capstone = support product; primary user = customers in chat; synthetic data MVP; prod DB later.  
3. Grand View Research — AI for Customer Service Market (2024 size ~USD 13.01B; CAGR ~23.2% 2025–2033). https://www.grandviewresearch.com/industry-analysis/ai-customer-service-market-report  
4. MarketsandMarkets — AI for Customer Service (2024 ~USD 12.06B; 2030 ~USD 47.82B; CAGR ~25.8%). https://www.marketsandmarkets.com/Market-Reports/ai-for-customer-service-market-244430169.html  
5. MarketsandMarkets — Conversational AI (2025 ~USD 17.05B context). https://www.marketsandmarkets.com/Market-Reports/conversational-ai-market-49043506.html  
6. GII / ResearchAndMarkets-style summary — AI for Customer Service 2024–2030 sizing (~USD 12.26B → ~USD 14.95B 2025). https://www.giiresearch.com/report/ires1803825-ai-customer-service-market-by-component.html  
7. ChatMaxima — AI customer support statistics compilation (2026). https://chatmaxima.com/blog/ai-customer-support-statistics-2026/  
8. Digital Applied — Customer Service AI Agent Statistics 2026 (deflection ~41.2% median). https://www.digitalapplied.com/blog/customer-service-ai-agent-statistics-2026-data  
9. Aissist.io — AI Customer Service Statistics 2026 (deflection vs vendor claims). https://aissist.io/insights/ai-customer-service-statistics  
10. GetVocal — Hybrid AI-human contact center benchmarks. https://www.getvocal.ai/blog/hybrid-ai-human-contact-center-benchmarks-roi  
11. Stealth Agents — Support ticket deflection statistics 2026. https://stealthagents.com/research/customer-support-ticket-deflection-statistics-2026  
12. Rasa — AI agent performance metrics (deflection vs solution rate vs CSAT). https://rasa.com/blog/measure-ai-agent-performance-in-the-contact-center  
13. Gorgias Blog — Best AI helpdesk tools review. https://www.gorgias.com/blog/best-ai-helpdesk-tools  
14. Fin.ai / Intercom learning — Best AI chatbots for customer support. https://fin.ai/learn/best-ai-chatbots-customer-support  
15. Pixeltree — AI customer support for DTC brands (Gorgias vs Zendesk; grounding & handoff). https://www.pixeltree.store/blog/ai-support-dtc-brands-2026  
16. Chatarmin — Zendesk AI limitations for ecommerce teams. https://chatarmin.com/en/blog/zendesk-ai-limitations  
17. GrowthNow — Gorgias vs Zendesk vs Intercom comparison. https://growthnow.in/gorgias-vs-zendesk-vs-intercom-enterprise-customer-support-stack-comparison-for-2025/  
18. AAMAD project config — `aamad.config.yml` (`runtime.target: claude-agent-sdk`).  
19. AAMAD MRD template — `.cursor/templates/mrd-template.md`.  
20. NovaMart practice DuckDB — `.../Maven-Analyst-101/ai-analyst-starter/data/practice/novamart_practice.duckdb` (inspected 2026-08-07; counts/categories in Data Source).  

---

## Assumptions

- NovaMart is the **fictional** ecommerce world from the course brief; Capstone productizes **customer support chat**, not Week 1 analytics Scenario D.  
- MVP authenticates lightly (email/order id) against synthetic data — not real SSO.  
- “Whatever you have” for crew roles → proposed six-agent crew above is acceptable until PRD revises.  
- No voice, social DMs, or email channel in MVP.  
- No real refunds, cancellations that mutate money, or carrier APIs in MVP.  
- Human L1 is **simulated** (ticket stub + summary) unless later specified.  
- Practice DuckDB is **read-only** for Capstone tools unless we explicitly add a write path for synthetic ticket stubs (separate store OK).  
- `support_tickets` metadata informs taxonomy; conversation content is not in the DB.  
- Historical 2024 timestamps are made demo-usable via adapter date-shift + `AS_OF_DATE` + optional overlay (not by mutating the practice file).  
- Market sizing informs opportunity narrative; Capstone success is demo/eval quality, not ARR.  
- Plus membership economics (trial conversion dip) motivate domain coverage but are not primary KPIs for the chat crew MVP.

---

## Open Questions

| # | Item | Status |
|---|------|--------|
| 1 | Return window / Plus policy copy | **Resolved** — invent in-repo corpus: 14-day returns; Plus trial 14 days → $14.99/mo or $99/yr; free shipping for members (PRD Assumptions) |
| 2 | Auth | **Resolved** — lite `order_id` and/or `user_id` validated against DuckDB |
| 3 | Trace UI | **Resolved** — operator-only (`?trace=1` / toggle) |
| 4 | Stack language | **Resolved** — TypeScript/Node + `claude-agent-sdk` (PRD/SAD ADR-01) |
| 5 | Mandatory demos | **Resolved** — PRD §7 eight eval scripts |
| 6 | NovaMart DB | **Resolved** — practice DuckDB P0 read backend; CI fixture copy |
| 7 | Chat script authoring | **Resolved** — hand-author core demos; category generation is P1+ |

*No blocking open questions remain for Build.*

---

## Audit

- **Timestamp**: 2026-08-07 (created); **2026-08-08** (quality pass / finalize); **2026-08-08** (runtime retrofit)  
- **Persona id**: `product-mgr`  
- **Action**: `create-mrd` + quality pass (align PRD/SAD locks) + runtime retrofit `cursor-sdk` → `claude-agent-sdk`  
- AAMAD_TARGET_RUNTIME: claude-agent-sdk  
- **Inputs**: `novamart.pdf`; stakeholder answers; `novamart_practice.duckdb`; web sources; PRD/SAD cross-check  
- **Output**: `project-context/1.define/mrd.md`  
- **Quality gate**: FINAL-FOR-BUILD — OQs closed; DuckDB P0; stack locked
