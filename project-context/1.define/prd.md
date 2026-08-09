# Product Requirements Document (PRD)
## Multi-Agent Customer Support Crew for NovaMart

## Input Requirements

| Input | Reference |
|-------|-----------|
| **Deep Research / MRD** | `project-context/1.define/mrd.md` (primary context; finalized) |
| **System Description** | N/A (not authored; MRD + this PRD are authoritative) |
| **System Concept** | Customer-facing multi-agent chat support crew for fictional mid-stage ecommerce NovaMart |
| **Selected Runtime** | `claude-agent-sdk` (`aamad.config.yml` → `runtime.target`; `AAMAD_TARGET_RUNTIME`); retrofitted 2026-08-08 from `cursor-sdk` |

**Traceability rule**: Every P0 feature below cites an **MRD pain / persona / gap**. Downstream agents must not invent market facts outside MRD/PRD Assumptions.

**Document status**: `FINAL-FOR-BUILD` (quality pass 2026-08-08).  
**Capstone freeze**: Build only P0 features in §4; P1 is time-permitting; P2/OUT are forbidden without a new PRD revision.

---

### 1. Executive Summary

#### Problem Statement (from MRD)

NovaMart shoppers need fast, accurate help on **orders, Plus membership, returns/shipping policy, and app issues**, but today’s patterns (ticket queues, FAQ loops, single generic bots) fail on **multi-step** journeys: lookup → policy → advice → escalate with context.

| Pain (MRD) | Evidence / signal | Who feels it |
|------------|-------------------|--------------|
| Slow / repetitive L1 for WISMO & policy | High ecommerce ticket volume; industry deflection gap (~41% median AI containment) | **P1 Shopper** |
| Plus trial/paid/shipping confusion | Plus is strategic; trial→paid slipped ~28%→~22% | **P2 Plus member/trialist** |
| Ticket spikes (e.g. Android / app v3.2.0) | `support_tickets` includes `app_version=3.2.0` (~4k); Scenario D validates spike pain | **P1** + **P4 Ops** (observer) |
| Escalations lack context | Humans re-ask; generic bots don’t package attempts | **P3 L1** (secondary; simulated in MVP) |
| Single-bot hallucination / weak tools | Competitive gap vs specialist + tool-contract approach | All personas |

**Scope of user population (MVP)**: NovaMart B2C customers in **web chat** (primary). Internal L1 and analytics pod are secondary/out of chat MVP.

#### Solution Overview

Build a **Multi-Agent Customer Support Crew** that:

1. Chats with customers in a streaming web UI.  
2. Routes each turn through a **Triage** agent to specialized agents (FAQ/Policy, Order, Plus, Returns Advisor).  
3. Grounds answers in **tools** (DuckDB / repository ports) and a **policy corpus**.  
4. Escalates via a dedicated **Escalation** agent with a complete handoff package (human simulated).  
5. Never executes payments/refunds in MVP.

**Differentiators (MRD UVPs → product)**

| Differentiator | Product implication |
|----------------|---------------------|
| Specialist crew vs mega-prompt | Six named agents with hard tool allowlists |
| Explicit tool contracts (`claude-agent-sdk`) | Typed tools; audit every call |
| Escalation as first-class agent | Required schema for handoff packages |
| NovaMart-domain fidelity | Plus + order + ticket taxonomy fields |
| DB-swap architecture | Repository ports; DuckDB adapter MVP |

**Expected outcomes (MVP success)** — see §7 for targets: ≥40% containment on in-scope demo scripts, ≥90% grounded auto-resolves, 100% complete escalations, 0 unsafe money actions, TTFT &lt; 5s.

#### Strategic Rationale

- **Why multi-agent**: Support intents span distinct domains (order state vs membership vs policy vs escalation). Specialization + handoff matches the MRD workflow analysis and reduces mega-prompt failure modes.  
- **Business/ops value (Capstone)**: Demonstrable deflection + escalation quality on NovaMart-shaped data; portfolio-ready operable demo.  
- **Positioning**: Not a Zendesk/Gorgias clone; a Capstone reference architecture for **grounded multi-agent ecommerce chat**.  
- **Scenario D**: Pain validation only — **no** causal analytics dashboard in MVP (MRD locked).

---

### 2. Market Context & User Analysis

#### Target Users (from MRD personas)

| ID | Persona | MVP role | Primary needs |
|----|---------|----------|---------------|
| P1 | Shopper | **Primary chat user** | Order status, shipping, returns policy, report app bug |
| P2 | Plus member / trialist | **Primary chat user** (subset) | Trial vs paid, free shipping, exclusives FAQ |
| P3 | L1 human agent | Secondary; **simulated** | Receive escalation package |
| P4 | Ops / PM | Observer | Metrics later; not a chat UI user in MVP |

#### User Needs → Feature Map

| MRD pain / need | Feature IDs (this PRD) |
|-----------------|------------------------|
| FAQ loops / waits | F-CHAT-01, F-TRIAGE-01, F-FAQ-01 |
| Wrong or ungrounded answers | F-ORDER-01, F-PLUS-01, F-FAQ-01, NFR-SAFE-01 |
| Plus confusion | F-PLUS-01, F-FAQ-01 |
| Multi-step order journeys | F-ORDER-01, F-ORCH-01 |
| App / release ticket spikes | F-TRIAGE-01, F-TICKET-01 |
| Re-asking on escalation | F-ESC-01 |
| Unsafe refund promises | F-RET-01, NFR-SAFE-01, OUT-01 |

#### User Journey (MVP — normative)

```text
Customer opens chat
  → Lite identity (order_id and/or user_id)
  → Triage: intent + entities + urgency
  → Specialist(s) with tools + policy citations
  → Resolve + optional CSAT
     OR Escalation agent → ticket stub + summary shown to customer
```

**Spike-flavored path** (support product view of Scenario D signal): customer reports Android crash → triage tags `device`, `app_version`, `category` → FAQ workaround if present else escalate — **no** analytics causal test.

#### Competitive stance (requirements-level)

Do **not** implement full helpdesk parity. Must beat a “single GPT + no tools” baseline on: grounding, specialist routing visibility (operator trace), and escalation package completeness.

#### Adoption barriers to design against

Wrong policy · infinite loops · opaque escalation · answers without order/Plus facts.

---

### 3. Technical Requirements & Architecture

> Requirements-level only. SAD owns low-level design. Runtime conventions follow `.claude/rules/adapter-claude-agent-sdk.md`.

#### 3.1 Runtime & Coordination (requirements)

| Requirement | Spec |
|-------------|------|
| Runtime | `claude-agent-sdk` |
| Pattern | **Hierarchical router**: Triage selects exactly one primary specialist per turn (may chain Returns after Order when needed); Escalation is terminal for that conversation thread until customer continues |
| Max agent hops / turn | Configurable; default **≤ 4** specialist hops before force-escalate |
| Memory | Conversation transcript + structured `SessionState` (intent, entities, tool results, citations); no cross-user memory |
| Tool discipline | Agents may call **only** tools on their allowlist |
| Streaming | Customer-visible token stream for assistant messages |
| Observability | Every turn logs: `agent_id`, tool name/args/result hash, latency_ms, escalation_reason |

**Language (locked)**: TypeScript/Node LTS + `claude-agent-sdk`. `aamad.config.yml` → `language.primary: typescript` (Python optional for one-off data scripts only).

#### 3.2 Core Agent Definitions

##### Agent: `triage-router`

| Field | Spec |
|-------|------|
| **role** | Classify customer utterance; extract entities; route |
| **goal** | Produce `Intent` + `Entities` + `urgency` and select next agent |
| **tools** | `extract_entities` (optional NLP helper), `get_user` (optional validation) |
| **outputs** | `{ intent, entities{order_id?, user_id?, device?, app_version?}, urgency, next_agent, confidence }` |
| **intents (P0)** | `order_status`, `plus_membership`, `returns_policy`, `shipping_policy`, `app_issue`, `payment_question`, `account_question`, `human_request`, `other` |
| **runtime notes** | No customer-facing long answers; may ask one clarifying question if `order_id`/`user_id` missing for order/plus intents |
| **MRD trace** | Multi-step journey failure; ticket taxonomy realism |

##### Agent: `faq-policy`

| Field | Spec |
|-------|------|
| **role** | Answer policy/FAQ from grounded corpus only |
| **goal** | Cite policy chunks; refuse if not grounded |
| **tools** | `search_policy(query) → {chunks[], citations[]}` |
| **must** | Include citation ids in reply metadata |
| **must not** | Invent return windows, prices, or legal claims |
| **escalate when** | No chunk with `score ≥ 0.55` (section/keyword search) OR customer disputes policy |
| **MRD trace** | FAQ loops; hallucination risk; Plus/shipping/returns clarity |

##### Agent: `order-specialist`

| Field | Spec |
|-------|------|
| **role** | Order and line-item facts |
| **goal** | Report status/totals/items from tools only |
| **tools** | `get_order(order_id)`, `get_order_items(order_id)`, `list_orders_for_user(user_id)` (limit ≤ 5) |
| **must not** | Cancel orders, issue refunds, change address |
| **MRD trace** | WISMO pain; tool-over-memory |

##### Agent: `plus-specialist`

| Field | Spec |
|-------|------|
| **role** | Plus membership lifecycle FAQ + status |
| **goal** | Explain trial/paid/cancel using membership record + policy |
| **tools** | `get_membership(user_id)`, `search_policy` (Plus subset) |
| **must not** | Start/cancel billing or charge cards |
| **MRD trace** | P2 Plus confusion; strategic Plus bet |

##### Agent: `returns-advisor`

| Field | Spec |
|-------|------|
| **role** | Advise return eligibility using policy + order flags |
| **goal** | Clear next steps; never execute refund |
| **tools** | `get_order`, `get_order_items`, `search_policy` |
| **must** | State “I can advise only; a human must process refunds” when refund requested |
| **must route to escalation** | Refund/chargeback requests, damaged goods claims needing compensation |
| **MRD trace** | Unsafe refund risk; advise-only boundary |

##### Agent: `escalation-handoff`

| Field | Spec |
|-------|------|
| **role** | Package context; create ticket stub; message customer |
| **goal** | 100% complete handoff packages |
| **tools** | `create_ticket_stub(payload)`, `format_handoff_summary` |
| **package schema (required fields)** | `intent`, `entities`, `urgency`, `transcript_summary`, `tools_tried[]`, `citations[]`, `reason_code`, `suggested_category`, `device?`, `app_version?`, `order_id?`, `user_id?` |
| **reason_codes** | `customer_requested_human`, `ungrounded`, `restricted_action`, `low_confidence`, `repeat_failure`, `high_severity`, `payment_or_refund` |
| **MRD trace** | Escalation quality; P3 pain; Scenario D field tagging |

#### 3.3 Interaction Patterns (normative)

| Pattern | Rule |
|---------|------|
| Customer → system | Single chat thread; customer never selects agent |
| Triage → specialist | Soft handoff; specialist sees `SessionState` |
| Specialist → specialist | Only Triage or orchestrator may re-route; Returns may be invoked after Order when intent is returns |
| Specialist → Escalation | On restricted action, ungrounded, or explicit human request |
| Visibility | Customer sees one assistant voice; **operator trace panel** shows agent hops (not customer-default) |

#### 3.4 Integration Requirements

| System | MVP requirement | Notes |
|--------|-----------------|-------|
| **Policy corpus** | Markdown/JSON files in repo; loaded by `search_policy` | Synthetic NovaMart policies (invented; see Assumptions) |
| **NovaMart practice DuckDB** | **P0 read-only** adapter for `users`, `orders`, `order_items`, `products`, `memberships` | Path via `NOVAMART_DUCKDB_PATH`; **temporal layer** required (see F-TIME-01) |
| **Demo overlay** | Tiny JSON/SQLite personas (3–5) with current-relative dates for eval scripts | Checked before DuckDB; never mutates practice DB |
| **Ticket stub store** | Separate writable store (SQLite) for escalation stubs | Do **not** require write to practice DuckDB |
| **support_tickets (DuckDB)** | **Out of MVP tool surface** (taxonomy enum only in code) | No body text; avoid large scans; P1+ if needed |
| **LLM provider** | Anthropic API via `claude-agent-sdk`; `ANTHROPIC_API_KEY` from project secrets; never commit keys | Per `aamad.config.yml` security |
| **Payments / carriers / Zendesk / Gorgias** | **Out of MVP** | — |
| **events / sessions / experiments** | **Out of MVP** | Analytics / Scenario D |
| **Auth provider** | Lite only: customer supplies `order_id` and/or `user_id`; validate exists in DB | No SSO/magic-link in MVP |

##### Repository port (DB-swap)

```text
OrderRepository, UserRepository, MembershipRepository, ProductRepository, PolicyRepository, TicketStubRepository
```

- MVP: DuckDB impl for read repos + **DateShiftMapper** + optional **DemoOverlayRepository**; SQLite for sessions/stubs; files for policy.  
- Future: swap DuckDB → prod/example DB without changing agents.

#### 3.5 Infrastructure (MVP)

| Area | Requirement |
|------|-------------|
| Hosting | Local dev + single-host deploy config (Deliver phase) |
| Compute | Laptop/small VM sufficient for demo concurrency (≤ 5 concurrent chats) |
| Secrets | Env / secret manager; forbid committed secrets |
| Logging | Structured JSON logs + optional trace export |
| Monitoring | Request latency, error rate, escalation rate, tool failure rate |
| Multi-region / HA | Deferred |

---

### 4. Functional Requirements

#### Feature ↔ Market problem matrix

| Feature ID | Priority | Solves (MRD) | Personas |
|------------|----------|--------------|----------|
| F-CHAT-01 | P0 | Waits / no self-serve chat | P1, P2 |
| F-TRIAGE-01 | P0 | Multi-step / misrouting; spike tagging | P1, P4 signal |
| F-FAQ-01 | P0 | FAQ loops; policy clarity | P1, P2 |
| F-ORDER-01 | P0 | WISMO / order facts | P1 |
| F-PLUS-01 | P0 | Plus confusion | P2 |
| F-RET-01 | P0 | Returns guidance without unsafe refunds | P1 |
| F-ESC-01 | P0 | Escalation re-ask pain | P1, P3 |
| F-TICKET-01 | P0 | App-issue intake / taxonomy | P1, P4 signal |
| F-CSAT-01 | P0 | Measure UX | P1 |
| F-TRACE-01 | P0 | Demo/debug multi-agent value | Operator / grader |
| F-ORCH-01 | P0 | Coordination integrity | System |
| F-EVAL-01 | P0 | Validation autonomy for QA | Build/QA |
| F-TIME-01 | P0 | 2024 DuckDB dates usable for 14-day / Plus demos | P1, P2, QA |
| F-AUTH-02 | P1 | Richer identity | P1 |
| F-COP-01 | P2 | L1 copilot | P3 |
| F-ANALYTICS-01 | P2 | Scenario D dashboard | P4 |
| F-WRITE-01 | P2 | Refund/cancel writes | P1 (future) |

---

#### P0 — Core Features

##### F-CHAT-01 — Customer chat UI

**User story**: As a NovaMart shopper (P1/P2), I want to chat in my browser so I can get help without waiting on email.

**Acceptance criteria**

- AC-CHAT-01: Web chat page loads; user can send/receive messages.  
- AC-CHAT-02: Assistant responses stream (token or chunk streaming).  
- AC-CHAT-03: UI shows typing/progress during tool/agent work without exposing raw tool JSON to customer by default.  
- AC-CHAT-04: Theme follows `aamad.config.yml` (`theme: system`, `visual_style: minimal`).  
- AC-CHAT-05: “Talk to a human” control always available → forces `human_request` → Escalation.

##### F-TRIAGE-01 — Intent routing & entity extraction

**User story**: As a shopper, I want my issue understood so I’m not stuck in the wrong FAQ.

**Acceptance criteria**

- AC-TRIAGE-01: System assigns one of the P0 intents (or `other`).  
- AC-TRIAGE-02: Extracts `order_id` / `user_id` when present; asks once if required and missing.  
- AC-TRIAGE-03: For app issues, captures `device` and `app_version` when stated (e.g. `3.2.0`).  
- AC-TRIAGE-04: Routes to correct specialist per intent map (SAD may refine; defaults below).

| Intent | Primary agent |
|--------|---------------|
| `order_status` | `order-specialist` |
| `plus_membership` | `plus-specialist` |
| `returns_policy` | `returns-advisor` (may call order tools) |
| `shipping_policy` | `faq-policy` |
| `app_issue` | `faq-policy`; if no chunk `score ≥ 0.55` → `escalation-handoff` |
| `payment_question` | `escalation-handoff` (always) |
| `account_question` | `faq-policy` for read-only FAQ; any password/email/PII-change request → `escalation-handoff` (`restricted_action`) |
| `human_request` | `escalation-handoff` |
| `other` | `faq-policy` → escalate if ungrounded |

##### F-FAQ-01 — Grounded policy answers

**User story**: As a shopper, I want correct NovaMart policy answers with sources.

**Acceptance criteria**

- AC-FAQ-01: Answers only from `search_policy` hits with **score ≥ 0.55**; if none, do not answer from model knowledge.  
- AC-FAQ-02: Response metadata includes citation ids; operator trace shows chunk ids + scores.  
- AC-FAQ-03: If ungrounded → escalate with `reason_code=ungrounded`.  
- AC-FAQ-04: Policy corpus files exist for: `shipping.md`, `returns.md` (14-day window), `plus.md` (trial/paid/pricing), `app_troubleshooting.md` (incl. Android / `3.2.0` stub workaround or “escalate”).  
- AC-FAQ-05: `search_policy` implementation for MVP is **section/keyword scoring** (no vector DB required).

##### F-ORDER-01 — Order lookup

**User story**: As a shopper, I want accurate order status and items from NovaMart data.

**Acceptance criteria**

- AC-ORDER-01: `get_order` returns status, totals, `is_plus_member_order`, device from DuckDB (or port).  
- AC-ORDER-02: Customer-visible totals/status match tool output exactly (no fabrication).  
- AC-ORDER-03: Unknown `order_id` → clear message + offer escalate.  
- AC-ORDER-04: No mutate/cancel/refund tools exposed.

##### F-PLUS-01 — Membership status & FAQ

**User story**: As a Plus trialist/member (P2), I want my plan status and benefit rules explained.

**Acceptance criteria**

- AC-PLUS-01: `get_membership` surfaces `plan_type`, `status`, dates when `user_id` known.  
- AC-PLUS-02: Benefit explanations grounded in policy citations.  
- AC-PLUS-03: Cancel/billing change requests → escalate (`restricted_action`).

##### F-RET-01 — Returns advice (no money movement)

**User story**: As a shopper, I want to know if I can return an item and what happens next — without the bot pretending a refund happened.

**Acceptance criteria**

- AC-RET-01: Advice combines order data + returns policy citations.  
- AC-RET-02: Explicit disclaimer when refund processing is required.  
- AC-RET-03: Refund/compensation language from customer → Escalation (`payment_or_refund`).  
- AC-RET-04: Zero payment/refund side effects in system (NFR-SAFE-01).

##### F-ESC-01 — Escalation package & ticket stub

**User story**: As a shopper (and future L1), I want a clean handoff so I don’t repeat myself.

**Acceptance criteria**

- AC-ESC-01: Creates ticket stub with all required package fields (§3.2).  
- AC-ESC-02: Customer sees confirmation + summary of what was captured.  
- AC-ESC-03: Stub persisted in writable store with unique id.  
- AC-ESC-04: `suggested_category` ∈ {`delivery_issue`, `payment_issue`, `product_quality`, `account_issue`, `membership_issue`, `other`}.  
- AC-ESC-05: Intent → category map (normative): `order_status`/`shipping_policy`→`delivery_issue`; `payment_question`→`payment_issue`; `returns_policy`→`product_quality` (or `delivery_issue` if shipping-return); `plus_membership`→`membership_issue`; `account_question`→`account_issue`; **`app_issue`→`other`**; `human_request`/`other`→`other` unless a more specific intent was known.

##### F-TICKET-01 — App-issue intake (Scenario D signal, not analytics)

**User story**: As a shopper with an app crash, I want my device/version recorded so support can act.

**Acceptance criteria**

- AC-TICKET-01: Captures `device` + `app_version` into session + escalation stub.  
- AC-TICKET-02: If policy has workaround for version, FAQ may resolve; else escalate.  
- AC-TICKET-03: No causal “is v3.2.0 the cause?” analysis UI or stats job.

##### F-CSAT-01 — Micro-survey

**User story**: As product/QA, I want a CSAT signal after resolve or escalate.

**Acceptance criteria**

- AC-CSAT-01: After resolve or escalate (`done` event), UI prompts 1–5 score (optional comment).  
- AC-CSAT-02: Score persisted in SessionStore (or sibling CSAT table) keyed by `conversationId`.  
- AC-CSAT-03: Skipping CSAT does not block conversation completion.

##### F-TRACE-01 — Operator agent-trace panel

**User story**: As a Capstone reviewer/operator, I want to see which agent and tools ran.

**Acceptance criteria**

- AC-TRACE-01: Toggle or `/debug` view lists ordered hops: agent, tools, latencies.  
- AC-TRACE-02: Hidden from default customer chrome (operator-only).  
- AC-TRACE-03: Does not leak secrets or full raw DB rows beyond what’s needed for demo.

##### F-ORCH-01 — Orchestration guards

**Acceptance criteria**

- AC-ORCH-01: Enforce tool allowlists per agent.  
- AC-ORCH-02: Enforce max hops; then escalate (`repeat_failure`).  
- AC-ORCH-03: Persist `SessionState` across turns in a conversation.

##### F-EVAL-01 — Scripted evaluation suite

**User story**: As QA, I want automated checks mapped to acceptance criteria.

**Acceptance criteria**

- AC-EVAL-01: ≥ 8 scripted dialogues covering P0 intents (list in §7).  
- AC-EVAL-02: Assert grounding (citation or tool) on auto-resolve paths.  
- AC-EVAL-03: Assert zero calls to forbidden money tools (none exist).  
- AC-EVAL-04: Assert escalation package schema validity.  
- AC-EVAL-05: Evals that depend on return windows or active trials set `AS_OF_DATE` (or use overlay personas) so results are deterministic.

##### F-TIME-01 — Temporal model for historical DuckDB

**User story**: As a shopper in a demo, I want return-window and Plus-trial answers to feel current even though the practice DB is 2024-dated.

**Problem**: Raw DuckDB timestamps are in **2024**. Wall-clock “today” would make nearly all 14-day return paths expire and trials look ancient.

**Acceptance criteria**

- AC-TIME-01: Read adapter supports **date shift**: by default compute  
  `shiftDays = floor(asOf − max(order_date in DB))` and add `shiftDays` to order/membership/user-facing timestamps **in tool outputs only** (DuckDB file unchanged).  
- AC-TIME-02: Env `ALIGN_MAX_DATE_TO_TODAY=true` (default **true** in demo) enables AC-TIME-01; `false` returns raw DB dates.  
- AC-TIME-03: Env `AS_OF_DATE=YYYY-MM-DD` overrides the clock used for eligibility (returns window, trial active/expired). If unset, `asOf = today (local)`.  
- AC-TIME-04: Env `DATE_SHIFT_DAYS=<int>` optionally forces an explicit shift instead of auto-align.  
- AC-TIME-05: Operator trace shows `{ asOf, shiftDays, alignMaxDateToToday }` on turns that use order/membership tools.  
- AC-TIME-06: **Demo overlay** file `data/demo_overlay.json` (3–5 personas) is checked **before** DuckDB for matching `user_id` / `order_id`; overlay dates are authored relative to `asOf` (e.g. order 3 days ago, Plus trial active).  
- AC-TIME-07: Return eligibility uses `asOf` and **shifted or overlay** `order_date`, never raw 2024 wall-clock mismatch without shift when align is on.  
- AC-TIME-08: Unit tests cover: align-on, align-off, `AS_OF_DATE` freeze, overlay precedence.

**Normative overlay personas (minimum)**

| Overlay id | Purpose |
|------------|---------|
| `demo-wismo` | Completed order ~3 days before `asOf` |
| `demo-returns-open` | Order within 14-day window |
| `demo-returns-closed` | Order >14 days before `asOf` |
| `demo-plus-trial` | Active Plus trial |
| `demo-app-android` | Identity + entities for app `3.2.0` script (order optional) |

---

#### P1 — Enhanced (not required for MVP demo, schedule if time)

| ID | Feature | Notes |
|----|---------|-------|
| F-AUTH-02 | Email + order_id correlation soft-login | Stronger than id paste |
| F-FAQ-02 | Promo-aware answers using `promotions` table | Welcome10, seasonal |
| F-ORDER-02 | “Similar open tickets” read from DuckDB | Optional |
| F-I18N-01 | Spanish responses | Deferred unless needed |

#### P2 — Future Work (explicitly out of MVP)

| ID | Feature | MRD link |
|----|---------|----------|
| F-ANALYTICS-01 | Scenario D causal dashboard | Out of MVP analytics |
| F-COP-01 | L1 agent copilot UI | P3 full product |
| F-WRITE-01 | Refund/cancel/membership write APIs | High risk |
| F-OMNI-01 | Email / voice / social | Channel expansion |
| F-ZENDESK-01 | Export to Zendesk/Gorgias | Competitor integration |
| F-PROD-DB-01 | True production DB | Post Capstone |

#### OUT — Hard exclusions (OUT-01)

- Payment capture, refund execution, card data handling  
- Causal experiment analysis for app v3.2.0  
- Training on real PII; production secrets in git  
- Omnichannel inbox  
- Replacing human legal/safety review  

---

### 5. Non-Functional Requirements

#### Performance

| ID | Requirement |
|----|-------------|
| NFR-PERF-01 | Perceived first token / chunk **&lt; 5s** under local demo load |
| NFR-PERF-02 | End-to-end auto-resolve turn **&lt; 30s** p95 for scripted evals (network/LLM dependent; document measured) |
| NFR-PERF-03 | Support **≥ 5** concurrent chat sessions on demo host |

#### Security & compliance

| ID | Requirement |
|----|-------------|
| NFR-SAFE-01 | **Zero** refund/payment execution paths in MVP code |
| NFR-SAFE-02 | No committed API keys/secrets (`forbid_committed_secrets: true`) |
| NFR-SAFE-03 | DuckDB path configurable; default read-only connection |
| NFR-SAFE-04 | Do not log full policy corpus or secrets; redact API keys |
| NFR-SAFE-05 | Treat DuckDB user rows as fictional; still minimize unnecessary PII display |
| NFR-SEC-01 | Security assessment artifact required before Deliver (`require_security_assessment: true`) |

#### Reliability & operability

| ID | Requirement |
|----|-------------|
| NFR-REL-01 | Tool failure → user-safe message + escalate or retry once |
| NFR-REL-02 | Structured logs for every agent hop |
| NFR-REL-03 | Config for model name, max hops, DuckDB path, policy path, `AS_OF_DATE`, `ALIGN_MAX_DATE_TO_TODAY`, `DATE_SHIFT_DAYS`, overlay path |
| NFR-OBS-01 | Metrics: containment, escalation rate, tool error rate, CSAT avg |

#### Quality / engineering standards (`aamad.config.yml`)

| ID | Requirement |
|----|-------------|
| NFR-ENG-01 | Type checking on; max file ~400 lines guidance |
| NFR-ENG-02 | Unit + integration tests; map to AC IDs |
| NFR-ENG-03 | User guide required in Deliver |
| NFR-UI-01 | Minimal visual style; prefer non-modal flows (`prefer_modals: false`) |

#### Scalability

MVP: vertical scale only; document horizontal scale as Future Work.

---

### 6. User Experience Design

#### Interface requirements

| Surface | Spec |
|---------|------|
| Primary | Single-page **customer chat** (desktop-first; usable on mobile width) |
| Secondary | **Operator trace** panel (toggle) |
| Not in MVP | Full agent desktop, analytics BI, admin CMS (policy files in repo OK) |

**Chat UX patterns**

- Welcome message states NovaMart Support Crew + what it can/can’t do (no refunds).  
- Identity capture: prominent fields or first-turn ask for `order_id` / `user_id`.  
- Citations: customer may see short “Based on NovaMart Returns Policy” plain language; chunk ids in trace.  
- Errors: plain language; offer human.  
- Accessibility: semantic HTML, keyboard-send, sufficient contrast (WCAG AA target best-effort for Capstone).

#### Agent interaction design

| Principle | Spec |
|-----------|------|
| Single voice | Customer hears one assistant persona (“NovaMart Support”) |
| Honesty | Prefer escalate over invent |
| Transparency | Operator trace for graders; optional “I checked order #…” phrasing for customers |
| Feedback | CSAT after terminal state |
| Loop break | Same failed tool/intent twice → escalate |

---

### 7. Success Metrics & KPIs

Aligned to MRD success table; Capstone measured on **eval scripts + demo**, not live traffic.

#### Operational / product metrics

| Metric | MVP target | Guardrail |
|--------|------------|-----------|
| Containment / deflection on in-scope scripts | **≥ 40%** | CSAT ≥ 3.5 on resolved |
| Grounded auto-resolve rate | **≥ 90%** of auto-resolved | — |
| Escalation package completeness | **100%** | Schema validation |
| Unsafe money actions | **0** | Hard fail CI |
| Fabricated order totals | **0** in eval | Hard fail |

#### Technical metrics

| Metric | Target |
|--------|--------|
| TTFT / first chunk | &lt; 5s |
| Tool allowlist violations | 0 |
| Eval suite pass | 100% of P0 scripts green in CI |

#### UX metrics

| Metric | Target |
|--------|--------|
| CSAT (1–5) on resolved scripts | Avg ≥ 3.5 (human rater or rubric) |
| Task completion on P0 scripts | ≥ 80% |

#### Mandatory eval scripts (F-EVAL-01)

| # | Intent | Expectation |
|---|--------|-------------|
| 1 | `order_status` | Tool-grounded status |
| 2 | `plus_membership` | Membership + policy |
| 3 | `returns_policy` | Citations; no refund exec |
| 4 | `shipping_policy` | Citations |
| 5 | `app_issue` + version 3.2.0 | Tags + FAQ or escalate |
| 6 | `human_request` | Full package |
| 7 | `payment_question` / refund ask | Escalate `payment_or_refund` |
| 8 | Unknown order_id | Safe failure path |

---

### 8. Implementation Strategy

#### Development phases (AAMAD)

| Phase | Deliverables |
|-------|--------------|
| **1. Define** | MRD ✅ · **PRD (this doc)** · next: user stories → SAD/SFS (`@system-arch`) |
| **2. Build** | Project setup · backend crew + tools · chat FE · integration · QA/evals |
| **3. Deliver** | Deploy config · user guide · security assessment · runbook |

#### Build sequence (recommended for agents)

1. `@project-mgr` — scaffold app (TS/Node + `claude-agent-sdk` adapter).  
2. Repository ports + DuckDB read adapter + policy corpus.  
3. `@backend-eng` — agents + orchestration + ticket stub store.  
4. `@frontend-eng` — chat UI + operator trace.  
5. `@integration-eng` — wire chat ↔ runtime API.  
6. `@qa-eng` — F-EVAL-01 + AC mapping.  
7. `@security-eng` — assessment before Deliver.  
8. `@devops-eng` — deploy + user guide.

#### Resource / risk mitigation

| Risk | Mitigation (product) |
|------|----------------------|
| Policy hallucination | Grounding hard-gate + escalate |
| Refund misunderstanding | Copy + no write tools + eval |
| DuckDB path / Google Drive latency | Config path; document copy-into-repo option for CI |
| Scope creep Scenario D | OUT-01 / F-ANALYTICS-01 P2 |
| Python vs TS config drift | Product decision: TS MVP; update config in setup |
| Multi-agent latency | Max hops; stream UX |

---

### 9. Launch & Go-to-Market Strategy

**N/A for Capstone commercial launch.**  
Demo/portfolio launch checklist:

- [ ] 8/8 eval scripts pass  
- [ ] Live demo: WISMO + Plus + returns advise + app issue escalate  
- [ ] Operator trace visible  
- [ ] User guide published  
- [ ] Security assessment filed  

---

## Quality Assurance Checklist

- [x] Requirements traceable to MRD personas/pains/gaps  
- [x] Runtime = `claude-agent-sdk` with adapter-aligned notes  
- [x] Success metrics aligned to MRD KPI table  
- [x] MVP vs P1/P2/OUT explicit  
- [x] Scenario D analytics excluded from MVP  
- [x] DuckDB registered as P0 read backend; chat/policy synthetic  
- [x] Agent roles, tools, interaction patterns specified  
- [x] UI/UX specified for customer + operator  

---

## Sources

1. `project-context/1.define/mrd.md` — primary  
2. `.cursor/templates/prd-template.md` — structure  
3. `aamad.config.yml` — runtime, UI, security, testing preferences  
4. `.claude/rules/adapter-claude-agent-sdk.md` — runtime conventions (by reference; superseded `.cursor/rules/adapter-cursor-sdk.mdc` 2026-08-08)  
5. NovaMart practice DuckDB — path and schema as documented in MRD  
6. Stakeholder lock: support product; customers in chat; synthetic chat/policy; DuckDB lookups  

---

## Capstone timeline realism

| Horizon | Commitment |
|---------|------------|
| Define (done) | MRD + PRD + SAD finalized |
| Build MVP | P0 only: chat, 6 agents, DuckDB reads + **F-TIME-01**, policy, stubs, trace, 8 evals |
| Explicitly not this Capstone | Scenario D analytics, refunds, omnichannel, prod DB, L1 copilot |
| Success bar | Demo + eval green; not production SLA / ARR |

---

## Assumptions

1. Synthetic **NovaMart policy corpus** in-repo: **14-day** return window; Plus **14-day trial** → **$14.99/mo** or **$99/yr**; free shipping for active Plus — aligned to NovaMart brief.  
2. Lite auth = validate `order_id` and/or `user_id` against DuckDB; no passwords.  
3. Operator trace is **not** shown to customers by default.  
4. Stack = **TypeScript/Node + claude-agent-sdk** (config updated; runtime retrofitted from `cursor-sdk` 2026-08-08, language unchanged).  
5. DuckDB is **P0** read backend; unit tests may mock ports; CI uses fixture copy under repo (e.g. `data/fixtures/novamart_practice.duckdb`) or `NOVAMART_DUCKDB_PATH`.  
6. Core demos are **hand-authored**; category utterance generation is P1+.  
7. Human L1 is simulated via ticket stub text only.  
8. `payment_question` / refund language **always** escalates.  
9. Capstone success = eval/demo quality, not ARR.  
10. Policy search MVP = section/keyword score; threshold **0.55**.  
11. `app_issue` → `suggested_category = other`.  
12. **Temporal model**: default date-shift align max DuckDB `order_date` → `asOf`; `AS_OF_DATE` for evals; demo overlay precedence (F-TIME-01). Practice DuckDB never rewritten.  

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| OQ-1 | Policy copy | **Resolved** — Assumption #1 + AC-FAQ-04 filenames |
| OQ-2 | `app_issue` category | **Resolved** — `other` |
| OQ-3 | CI DuckDB | **Resolved** — copy/fixture in repo for CI; Drive path for local OK |
| OQ-4 | Model tier | **Resolved (default)** — use org-available mid-tier chat model via `MODEL_ID` env; record actual id in Build Audit (not a product fork) |
| OQ-5 | TS language | **Resolved** — typescript primary |

*No blocking product open questions remain.* Residual engineering choices (exact monorepo layout) live in SAD and are locked there.

---

## Audit

- **Timestamp**: 2026-08-07 (created); **2026-08-08** (quality pass / finalize); **2026-08-08** (runtime retrofit)  
- **Persona id**: `product-mgr`  
- **Action**: `create-prd` + quality pass (specificity, traceability, OQ closure) + runtime retrofit `cursor-sdk` → `claude-agent-sdk`  
- AAMAD_TARGET_RUNTIME: claude-agent-sdk  
- **Inputs**: `mrd.md`; PRD template; `aamad.config.yml`; SAD cross-check  
- **Output**: `project-context/1.define/prd.md`  
- **Quality gate**: FINAL-FOR-BUILD — P0 AC testable; MRD↔PRD matrix present; scope frozen  
- **Handoff**: SAD finalized in parallel; next `*create-stories` (optional) or Build `@project-mgr` setup.
