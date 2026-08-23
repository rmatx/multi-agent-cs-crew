# Setup Epic — NovaMart Support MVP

Retrospective setup record. The project already exists, is installed, and runs; this document
describes **what is on disk on 2026-08-23**, not a plan for a future scaffold. Where the code
and the SAD disagree, the code is described as-is and the disagreement is recorded under
Open Questions rather than silently reconciled.

Nothing here was installed, upgraded, or refactored by this pass. Two edits were made and
both are listed under *Changes made by this pass*.

## The one thing to know first

**The default engine is keyless and free.** `CHAT_ENGINE` unset ⇒ `deterministic`: the reply
is composed in code from a read-only DuckDB lookup plus the `DateShiftMapper`. No model call,
no network, no spend. That is what makes this repo runnable on a fresh clone with nothing but
`npm install`.

`CHAT_ENGINE=sdk` is opt-in and **bills your Anthropic key on every turn**. See
*Cost warning* under Run instructions before you set it.

---

## 1. Prerequisites and pinned versions

Verified on the development host on 2026-08-23.

| Tool | Verified version | How to check | Notes |
|------|------------------|--------------|-------|
| Node.js | **v25.9.0** | `node -v` | `@types/node@26.2.0`. Node ≥ 20 is the practical floor (Next 16 requirement); 25.x is what this repo is exercised on. |
| npm | **11.12.1** | `npm -v` | Ships with the Node above. `package-lock.json` is lockfileVersion-current; use `npm ci` for reproducible installs. |
| TypeScript | **5.9.3** | `npx tsc -v` | Local devDependency, not global. |
| Python | 3.x + `duckdb` | — | **Optional.** Only for `scripts/build-ci-fixture.py`. A `.venv/` exists locally and is gitignored. Not needed to run the app. |
| Anthropic API key | — | — | **Optional.** Required only for `CHAT_ENGINE=sdk`. |

No global installs are required. No Docker, no database server: DuckDB is an embedded file.

### Platform notes

- `@duckdb/node-api` is a **native addon**. It is kept out of the server bundle via
  `serverExternalPackages` in `next.config.ts`. A platform change (arch or Node major)
  requires a fresh `npm install` so the correct prebuilt binary is fetched.
- Turbopack is the Next 16 default. `next build` emits one **dynamic-filesystem-access
  warning** from the DuckDB path resolution (`path.join(process.cwd(), …)` in
  `server/data/duckdb.ts`). Warning only; expected; not a defect.

---

## 2. Repository layout (actual)

This is a **repo-root Next.js App Router project**. SAD §3 sketches `apps/web/…` and SAD §4
sketches `apps/web/server/…`, but both are explicitly labelled *"(suggested)"* and SAD §3
line 449 reads `apps/web/   (or repo-root Next app)`. Repo-root is therefore a **sanctioned
choice, not a deviation** — there is one app, so a monorepo shell would be ceremony.

```text
.
├── app/                          # Next App Router (UI + BFF route handlers, ADR-09)
│   ├── page.tsx, page.module.css # single chat column
│   ├── layout.tsx, globals.css
│   └── api/
│       ├── chat/route.ts         # POST — SSE turn endpoint
│       └── health/route.ts       # GET  — status / runtime / duckdb / engine
├── lib/                          # client-side, browser-safe only
│   ├── chatClient.ts, fsm.ts, status.ts
│   └── services/turnService.ts, mockStream.ts
├── server/                       # Node-only. Imported from route handlers, never from a
│   │                             # client component (ADR-09).
│   ├── data/duckdb.ts            # READ_ONLY connection
│   ├── data/dateShift.ts         # DateShiftMapper
│   └── runtime/
│       ├── config.ts             # engine selection + all execution budgets
│       ├── engine.ts, engines/{select,deterministic,sdk}.ts
│       ├── agents.ts, tools.ts, toolRegistry.ts, hooks.ts
│       ├── escalation.ts, stubs.ts, trace.ts
│       └── toolRegistry.test.ts  # zero-money-tools invariant suite
├── packages/shared/src/dto.ts    # frozen wire contract (SAD §4 contract freeze gate)
├── data/
│   ├── fixtures/
│   │   ├── novamart_ci.duckdb        # 3.0 MB — COMMITTED
│   │   └── novamart_practice.duckdb  # 151 MB — GITIGNORED, untracked
│   └── policy/                   # created by this pass; empty (Sprint 2 policy corpus)
├── scripts/build-ci-fixture.py   # CI fixture generator (SAD-OQ-6)
├── project-context/              # AAMAD artifacts (1.define / 2.build / 3.deliver)
│   └── 2.build/logs/             # runtime JSONL traces — GITIGNORED
├── .env.example                  # names only
├── .env.local                    # gitignored, never committed, never read by tooling
├── aamad.config.yml, next.config.ts, tsconfig.json, package.json
└── README.md, AGENTS.md, frontend-functional-spec.md
```

### Path aliases (`tsconfig.json`)

| Alias | Resolves to |
|-------|-------------|
| `@shared/*` | `./packages/shared/src/*` |
| `@/*` | `./*` (repo root — hence `@/server/...`) |

`strict: true` **and** `noUncheckedIndexedAccess: true` are on. `allowJs: false`.

### Directories deliberately **not** present

- `apps/web/` — repo-root layout chosen instead (above).
- `app/components/` — SAD §3 lists ChatWindow / MessageList / Composer / TracePanel etc. The
  Sprint 1 slice is one `app/page.tsx`; component extraction is deferred, not missed.
- `app/api/conversations/[id]/trace/route.ts` — not built. Operator visibility is the JSONL
  log plus `X-Novamart-*` response headers (SAD Sprint 1 accepts this).
- `multi_agent_cs_crew/` — a CrewAI scaffold once lived here and was **deleted in commit
  1173b88**. `AAMAD_TARGET_RUNTIME=claude-agent-sdk` is the one active runtime; there is no
  Python crew, no `config/agents.yaml`, no `crew.py`. `.claude/rules/adapter-crewai.md` and
  `adapter-cursor-sdk.md` remain on disk as framework artifacts and are **not loaded**.

---

## 3. Dependency inventory

Declared range → installed version, read from `package.json` and `npm ls --depth=0` on
2026-08-23. **Recorded, not changed.** No install, upgrade, or audit was run by this pass.

### Runtime dependencies

| Package | Declared | Resolved | Why it is here |
|---------|----------|----------|----------------|
| `next` | `^16.3.1` | **16.3.1** | App Router UI + BFF route handlers (ADR-02 / ADR-09). Turbopack. |
| `react` | `^19.2.8` | **19.2.8** | ADR-02 |
| `react-dom` | `^19.2.8` | **19.2.8** | ADR-02 |
| `@duckdb/node-api` | `^1.5.5-r.4` | **1.5.5-r.4** | Read-only NovaMart adapter (ADR-05). Native addon. Substituted for the SAD's `duckdb` package — see `frontend-functional-spec.md` Open Questions. |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.241` | **0.3.241** | The `sdk` engine. Added 2026-08-23. Unused on the default path. |

### Dev dependencies

| Package | Declared | Resolved |
|---------|----------|----------|
| `typescript` | `^5.9.3` | **5.9.3** |
| `@types/node` | `^26.2.0` | **26.2.0** |
| `@types/react` | `^19.2.18` | **19.2.18** |
| `@types/react-dom` | `^19.2.4` | **19.2.4** |

### Notable transitive

| Package | Resolved | Status |
|---------|----------|--------|
| `zod` | **4.4.3** | **Imported directly by `server/runtime/tools.ts`** (the SDK's `tool()` helper needs a Zod raw shape) but reaches the tree only through `@anthropic-ai/claude-agent-sdk`. This is a real gap — see Known gaps SG-1. |

`npm ls --depth=0` also reports `@emnapi/runtime@1.11.3` and `@img/sharp-wasm32@0.35.3` as
**extraneous** (optional platform artifacts of `next`'s image pipeline, left over from a
previous install). Harmless, cosmetic, and deliberately **not** cleaned by this pass — see
SG-2.

### Not installed, on purpose

No linter package is installed even though `aamad.config.yml` sets `coding_standards.style_guide: eslint`
(SG-3). No test framework: `test:invariants` uses the built-in `node --test`. No CrewAI, no
Python runtime dependency for the app.

---

## 4. Environment variable contract

`.env.local` at the repo root, gitignored at `.gitignore:7`. **Names only** live in
`.env.example`; no value appears in any committed file or in this artifact. `.env.local` was
confirmed to exist and to be ignored, and was **not opened** — it holds a live API key.

Legend: **Required** = the code fails or refuses without it. Everything else is optional with
the default shown.

### Engine selection

| Name | Req. | Default | Read at | Meaning |
|------|------|---------|---------|---------|
| `CHAT_ENGINE` | no | `deterministic` | `runtime/config.ts:21` | `deterministic` \| `sdk`. Unset, empty, **or unrecognised** ⇒ `deterministic`. A typo is deliberately not an error — it must never take the demo offline. |

### `sdk` engine only

| Name | Req. | Default | Read at | Meaning |
|------|------|---------|---------|---------|
| `ANTHROPIC_API_KEY` | **yes, if `CHAT_ENGINE=sdk`** | — | `config.ts:131` | Missing ⇒ one clean `sdk_engine_unconfigured` error frame + `done{escalated}`. Never a crash. |
| `MODEL_ID` | **yes, if `CHAT_ENGINE=sdk`** | **none — never defaulted** | `config.ts:141` | Required by design so the resolved model is always in the run trace. A silently chosen model makes the Audit line a lie and evals irreproducible. |
| `SDK_STREAM_MODE` | no | `final` | `config.ts:115` | `final` buffers coordinator text and emits on resolve; `live` streams deltas. Subagent text is suppressed in both modes, structurally. |

### Execution budgets (`server/runtime/config.ts`)

Every budget resolves to a concrete number here. Nothing falls through to an SDK default.
Non-numeric or non-positive input silently falls back to the default shown.

| Name | Req. | Default | Meaning |
|------|------|---------|---------|
| `MAX_HOPS` | no | `4` | Agent transfers per turn. A tool call is **not** a hop (SAD hop accounting). |
| `MAX_MODEL_TURNS` | no | `12` | Model turns inside the SDK loop; caps tool ping-pong. |
| `TURN_TIMEOUT_MS` | no | `60000` | Wall clock for the whole turn. |
| `MAX_OUTPUT_TOKENS` | no | `4096` | Output ceiling per turn. Overrun ⇒ halt + Diagnostic, never silent truncation. |
| `MODEL_EFFORT` | no | `low` | `low\|medium\|high\|xhigh\|max`. **This is the determinism and cost lever.** |
| `MAX_THINKING_TOKENS` | no | **unset (adaptive)** | Fixed thinking budget for **older models only** (e.g. `claude-haiku-4-5`). Must stay UNSET on Opus 4.6+ / Sonnet 4.6+ / Opus 5 / Sonnet 5, which use adaptive thinking. |
| `TOOL_READ_RETRIES` | no | `1` | Retries for an idempotent repository read. Validation errors are not retried. |

> **There is deliberately no `MODEL_TEMPERATURE`.** It was removed on 2026-08-23. `temperature`
> no longer exists on the Messages API for Opus 5 / Sonnet 5 / Opus 4.7+ (sending it returns a
> 400) and the Agent SDK exposes no temperature option at all. Determinism is pinned with
> `MODEL_EFFORT` instead. **Do not reintroduce it**, and do not add it back to `.env.example`.

### Data and temporal layer

| Name | Req. | Default | Read at | Meaning |
|------|------|---------|---------|---------|
| `NOVAMART_DUCKDB_PATH` | no | `data/fixtures/novamart_ci.duckdb` | `data/duckdb.ts:17` | Absolute path used as-is; relative path resolved against `process.cwd()`. Point it at the 151 MB practice DB for full-fidelity local work. |
| `AS_OF_DATE` | no | today (UTC) | `data/dateShift.ts:30` | `YYYY-MM-DD`. Demo clock and shift anchor. **Pin it for reproducible evals.** A malformed value is ignored and today is used. |
| `ALIGN_MAX_DATE_TO_TODAY` | no | `true` | `dateShift.ts:36` | Only the exact string `false` disables it. When off, `shiftDays = 0`. |
| `DATE_SHIFT_DAYS` | no | computed | `dateShift.ts:43` | If set and finite, overrides the auto shift entirely. |

### Frontend

| Name | Req. | Default | Read at | Meaning |
|------|------|---------|---------|---------|
| `NEXT_PUBLIC_USE_MOCK_STREAM` | no | unset | `lib/chatClient.ts:60` | `1` drives the UI from `lib/services/mockStream.ts` instead of the real endpoint. `NEXT_PUBLIC_*` is **inlined into the client bundle at build time** — never put a secret in one. |

### Platform / tooling (not read by application code)

| Name | Source | Meaning |
|------|--------|---------|
| `AAMAD_TARGET_RUNTIME` | `.claude/settings.json` → `env`, mirrored at `aamad.config.yml:12` | `claude-agent-sdk`. Consumed by the AAMAD rule loader, not by the app. Env takes precedence over the config file; both are set to the same value, so no ambiguity. |
| `PORT` | Next.js | Server port. Also settable with `next dev -p` / `next start -p`. |
| `npm_package_version` | npm | Injected by npm; surfaced by `/api/health` as `version`, falling back to `"1.0.0"`. Do not set by hand. |

### `.env.example` drift audit

Cross-checked every `.env.example` entry against every `process.env.*` read in
`app/`, `lib/`, `server/`, `packages/`, `scripts/`, and `next.config.ts`.

**Read by code but missing from `.env.example` — 1 finding, fixed by this pass:**

| Name | Resolution |
|------|------------|
| `NEXT_PUBLIC_USE_MOCK_STREAM` | **Added** to `.env.example` (empty value + comment). Read at `lib/chatClient.ts:60` since the Frontend epic; never declared. |

**In `.env.example` but read by no code today — 5 forward declarations, left in place:**

| Name | Status |
|------|--------|
| `DEMO_OVERLAY_PATH` | Sprint 2+. `demo_overlay.json` does not exist; `overlayHit` is hard-coded `false`. |
| `POLICY_CORPUS_PATH` | Sprint 2+. `data/policy/` created empty by this pass. |
| `TICKET_STUB_DB_PATH` | Sprint 2 layer 5. Ticket stubs are in-memory today. |
| `SESSION_DB_PATH` | Sprint 2 layer 5. Sessions are per-turn today. |
| `OPERATOR_KEY` | SAD §4 operator-key auth; not implemented (backend Known gap 8). |

These are intentional placeholders for named SAD/PRD capabilities (NFR-REL-03), not drift.
They are documented as **inert** so nobody sets one and expects an effect.

**No other drift.** Every remaining `.env.example` name is read by code, and every
`process.env` read in application code is declared.

---

## 5. Run instructions

### Cost warning — read before changing `CHAT_ENGINE`

- `CHAT_ENGINE` **unset** (or anything but `sdk`) ⇒ the **deterministic** engine. Free.
  No model call, no network egress, no key needed. This is the safe default and the demo path.
- `CHAT_ENGINE=sdk` ⇒ **every turn calls the Anthropic API and bills your key.** Cost scales
  with `MODEL_EFFORT` and `MAX_OUTPUT_TOKENS`. Do not set it in a shared shell profile, do not
  commit it, and unset it the moment you are done.
- `GET /api/health` reporting `"sdkEngineConfigured": true` means **a key is present**, not
  that it is being used. Read `"engine"` on the same response to know what will actually run.
- Returning to free operation is instant: unset `CHAT_ENGINE` and restart.

### First run (fresh clone)

```bash
npm ci                 # or `npm install`; reproducible from package-lock.json
cp .env.example .env.local     # optional — every var has a working default
npm run dev            # http://localhost:3000
```

Works with **no `.env.local` at all**: the committed 3.0 MB CI fixture is the default DB and
the deterministic engine needs no key.

### Scripts (`package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `next dev` | Dev server, Turbopack, HMR. `-p <port>` to move it. |
| `npm run build` | `next build` | Production build. |
| `npm start` | `next start` | Serve the production build (requires `build` first). |
| `npm run typecheck` | `tsc --noEmit` | Strict typecheck. |
| `npm run test:invariants` | `node --test server/runtime/toolRegistry.test.ts` | Zero-money-tools invariant suite. |

### Free deterministic smoke test

With a dev server up (assume port 3000; substitute yours):

```bash
curl -s http://localhost:3000/api/health

curl -s -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Where is my order?","identity":{"orderId":1},"clientFlags":{"trace":true}}'
```

Expect `engine: "deterministic"` from health, then an SSE stream of
`session → agent_hop → tool_call → token… → citation → done{status:"resolved"}`, with
`X-Novamart-*` headers carrying `as-of`, `shift-days`, `overlay-hit`, `engine`.
Actual output is in *Verification* below.

### Ports and clean shutdown

- Next 16 permits **one dev server per directory**. If `npm run dev` reports the port busy,
  a server is already up — reuse it rather than killing it.
- Need an isolated instance? `npm run build && npx next start -p 3117`, then stop it and free
  the port when finished. Confirm with `lsof -nP -iTCP:3117 -sTCP:LISTEN`.
- Shutdown is `Ctrl-C` (SIGINT). The DuckDB connection is process-wide and lazily opened; it
  is read-only, so an abrupt exit cannot corrupt the fixture.
- After any run, `git status` should show no `.duckdb`, no `.env*`, and no `logs/` entries.

### Useful one-offs

```bash
AS_OF_DATE=2026-08-13 npm run dev                        # pin the demo clock
NOVAMART_DUCKDB_PATH=/abs/path/novamart_practice.duckdb npm run dev
NEXT_PUBLIC_USE_MOCK_STREAM=1 npm run dev                # UI against the mock stream
```

---

## 6. Fixtures and the date-shift knobs

### The two-database split (settled — SAD-OQ-6, ADR-12)

| File | Size | Tracked? | Role |
|------|------|----------|------|
| `data/fixtures/novamart_practice.duckdb` | **151 MB** (158,347,264 B) | **No** — gitignored at `.gitignore:24`, untracked | The **authoritative** dataset. Stays local. Exceeds GitHub's 100 MB hard file limit, so it cannot be committed. |
| `data/fixtures/novamart_ci.duckdb` | **3.0 MB** (3,158,016 B) | **Yes** — committed via the `!` un-ignore at `.gitignore:25` | The CI / fresh-clone fixture and the **default** at `server/data/duckdb.ts:14`. |

The CI fixture is scoped **by table, not by row**: the five MVP-read tables (`users`,
`orders`, `order_items`, `products`, `memberships`) with **every row intact**. The 148 MB of
difference is `events` (6.5 M rows) and `sessions` (1.4 M rows), which no MVP tool reads.
Whole-table copies keep it a sample-free replica, so a query that holds locally holds in CI.

This split is **correct and intentional**. Do not `git add` the practice DB, and do not weaken
`.gitignore:24`.

Regenerate with `scripts/build-ci-fixture.py` (opens the source read-only, writes to a temp
file, atomically replaces the target); `--check` verifies the committed fixture without
rebuilding. The fixture is *content*-deterministic but **not byte-reproducible** — DuckDB
stamps internal metadata on every write, so a no-op rebuild still yields a 3 MB binary diff.
**Rebuild only when the practice DB changes; use `--check` in CI.**

### Connection safety

`server/data/duckdb.ts` opens with `access_mode: "READ_ONLY"` and exposes reads only. Any
INSERT/UPDATE/DELETE against the practice DB is a defect.

### Date-shift knobs

The dataset is frozen in 2024–2025. `DateShiftMapper` shifts dates **inside the repository
adapter**, so raw practice-DB dates never reach the agent, the response, or the UI.

```text
shiftDays = AS_OF_DATE − max(order_date)      # when ALIGN_MAX_DATE_TO_TODAY (default true)
shiftDays = DATE_SHIFT_DAYS                   # when set — overrides the computation
shiftDays = 0                                 # when ALIGN_MAX_DATE_TO_TODAY=false
```

Precedence: `DATE_SHIFT_DAYS` > `ALIGN_MAX_DATE_TO_TODAY=false` > computed alignment.
Shifted dates are deliberately **not** clamped to `asOf` (SAD §4 consequence 1).

The model receives `{ asOf }` and nothing else. `shiftDays`, `alignMaxDateToToday`, and
`overlayHit` are operator-only — response headers and the Prompt Trace log. An agent that
could read `shiftDays` could subtract it back off and reason about the real 2024 data, which
is exactly what the temporal layer exists to prevent.

**For reproducible runs, pin `AS_OF_DATE`.** Left unset, `shiftDays` moves every day and
identical requests produce different dates.

Measured on 2026-08-23 with `AS_OF_DATE` unset: `shiftDays = 599`; order 1 renders as
`2025-08-23`.

---

## 7. Changes made by this pass

Two, both inside the Setup persona's remit:

1. **`.env.example`** — appended `NEXT_PUBLIC_USE_MOCK_STREAM=` (empty value + comment) under
   a new *Frontend* section. Names only; no value.
2. **`data/policy/.gitkeep`** — created the documented-but-missing directory named by SAD §3
   (`data/policy/*.md`) and by `POLICY_CORPUS_PATH`. Empty; the corpus itself is Sprint 2.

Explicitly **not** done, per the scope of this pass: no `npm install` / `update` / `audit fix`,
no edit to `package.json` or `package-lock.json`, no application code touched, no PRD / SAD /
frontend.md / backend.md modified, and `.env.local` never opened.

---

## 8. Known setup gaps / deferred items

| ID | Gap | Impact | Owner |
|----|-----|--------|-------|
| **SG-1** | **`zod` is used directly but declared nowhere.** `server/runtime/tools.ts` imports `zod`; `zod@4.4.3` reaches the tree only as a transitive of `@anthropic-ai/claude-agent-sdk`. A future SDK release that drops or bumps zod breaks the `sdk` engine build with no lockfile signal. | Latent build break on the `sdk` path only; the deterministic path does not import `tools.ts`. | `@project.mgr` — promote to a direct `dependencies` entry pinned to the currently-resolved `4.4.3`. Requires an install, which was out of scope here. |
| **SG-2** | Two **extraneous** packages in the tree (`@emnapi/runtime@1.11.3`, `@img/sharp-wasm32@0.35.3`) — optional platform artifacts of `next`'s image pipeline left by an earlier install. | Cosmetic; `npm ls` is noisy. A fresh `npm ci` clears them. | `@project.mgr`, next install cycle. |
| **SG-3** | **No linter installed.** `aamad.config.yml` sets `coding_standards.style_guide: eslint`, and SAD's CI sketch opens with a lint stage, but no ESLint package or config exists. `npm run lint` does not exist. | The documented CI pipeline cannot run its first stage. | `@devops.eng` at `*configure-cicd`, or `@project.mgr` if a lint install is authorised. |
| **SG-4** | **No CI workflow file.** No `.github/workflows/`. SAD §5 specifies lint → typecheck → unit → integration → build, and the `--check` fixture guard has no runner. | CI is documented but not executable. | `@devops.eng`, Deliver phase. |
| **SG-5** | **No `.nvmrc` / `engines` field.** Node version is verified (v25.9.0) but not pinned anywhere machine-readable, so a contributor on an older Node gets a Next 16 failure with no early signal. | Onboarding friction. | `@project.mgr` — needs a `package.json` edit, out of scope here. |
| **SG-6** | **No `.dockerignore` / container definition.** SAD §5 `demo` env assumes one container/VM. | Blocks the Deliver deploy definition. | `@devops.eng` at `*define-deploy`. |
| **SG-7** | **The `sdk` engine has never executed a turn.** Its failure path is verified; nothing past the preflight is. Setup can install and configure it but cannot validate it without spending. | Everything below `preflightSdkEngine` is unvalidated. | `@qa.eng` / operator, when a spend budget is authorised. |
| **SG-8** | `data/policy/`, `data/demo_overlay.json`, `data/*.sqlite` are **empty or absent**; the corresponding env names are inert placeholders. | Sprint 2 scope. Nothing in Sprint 1 depends on them. | `@backend.eng`, Sprint 2. |
| **SG-9** | **No secret scanning.** `forbid_committed_secrets: true` is enforced only by `.gitignore` and reviewer discipline; no pre-commit hook or scanner exists. | A stray key could be committed. | `@security.eng` at `*assess-security`. |

---

## Verification

All commands below are **free** — no model call, no API key use, no token spend. Run on
2026-08-23.

**`npm run typecheck`** — exit 0, no diagnostics:

```text
> multi-agent-cs-crew@1.0.0 typecheck
> tsc --noEmit
```

**`npm run test:invariants`** — **9 passed, 0 failed**:

```text
✔ the registered tool set is exactly the reviewed Sprint 1 set (1.619917ms)
✔ no registered tool is a money tool (0.143583ms)
✔ no tool anywhere in the MVP contract is a money tool (0.069708ms)
✔ no agent allowlist grants a money tool (0.091333ms)
✔ money vocabulary is actually detected (0.231166ms)
✔ drift in the registered set is a hard failure (0.103292ms)
✔ only the coordinator holds the delegation tool (0.083416ms)
✔ no agent holds a built-in shell / write / network tool (0.077459ms)
✔ specialists cannot delegate, structurally (0.088292ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

One benign `node --test` notice: `MODULE_TYPELESS_PACKAGE_JSON` (the test file is ESM and
`package.json` has no `"type": "module"`). Performance notice only; nothing fails.

**`GET /api/health`** against the dev server already running on port 3111 (not started or
stopped by this pass):

```text
HTTP/1.1 200 OK
{"status":"ok","runtime":"claude-agent-sdk","duckdb":"ok","engine":"deterministic","sdkEngineConfigured":true,"version":"1.0.0"}
```

`engine: "deterministic"` confirmed **before** any chat request was sent — that is what made
the smoke test safe to run. `sdkEngineConfigured: true` reports only that a key is present in
the server's environment; no key value was read, and the `sdk` engine was never selected.

**`POST /api/chat`, deterministic engine, `orderId: 1`, `trace: true`** — `AS_OF_DATE` unset,
so `asOf = 2026-08-23` and `shiftDays = 599`:

```text
x-novamart-as-of: 2026-08-23
x-novamart-conversation-id: 7a0b4adf-360d-403d-aaad-ad370b6bae91
x-novamart-engine: deterministic
x-novamart-overlay-hit: false
x-novamart-shift-days: 599

data: {"type":"session","conversationId":"7a0b4adf-360d-403d-aaad-ad370b6bae91"}
data: {"type":"agent_hop","agentId":"order-specialist","hop":1}
data: {"type":"tool_call","agentId":"order-specialist","tool":"get_order"}
data: {"type":"token","text":"Order"} … (token-incremental)
data: {"type":"citation","ids":["duckdb:orders:1","duckdb:order_items:1"]}
data: {"type":"done","status":"resolved"}
```

Assembled reply:

```text
Order 1 is completed.
Placed 2025-08-23 (365 days ago). Order total $64.36.
Items:
- BalanceSet Yoga Max x1 — $58.37
I can't process refunds, cancellations, or payments here.
```

Grounded, date-shifted (2025, not 2024), cited, and carrying the standing
no-refunds/cancellations/payments line. Matches the Backend epic's recorded run exactly.

**Repository hygiene** — `git check-ignore -v`:

```text
.gitignore:7:.env.local        .env.local
.gitignore:24:data/fixtures/*.duckdb    data/fixtures/novamart_practice.duckdb
```

`git ls-files data/fixtures/` returns exactly `.gitkeep` and `novamart_ci.duckdb`. The
practice DB is untracked. `.env.local` was confirmed to exist and to be ignored; it was
**not opened, read, or printed**, and no secret value appears anywhere in this artifact.

**Not run, on purpose:** no `npm install`/`update`/`audit fix`; no build (the running dev
server on 3111 was left undisturbed rather than risking its `.next` state); no request with
`CHAT_ENGINE=sdk`; no call to the Anthropic API. **Zero API tokens were spent.**

---

## Sources

- `project-context/1.define/prd.md` — §3.5 Infrastructure, §5 NFR (NFR-SAFE-02/03,
  NFR-REL-03, NFR-ENG-01/02), §8 Implementation Strategy
- `project-context/1.define/sad.md` — §3 Application structure (suggested), §4 Suggested
  package layout + API contracts, §5 Physical/Deployment (environments, CI/CD), ADR-05,
  ADR-09, ADR-12, ADR-14, SAD-OQ-6 resolution
- `project-context/2.build/frontend.md` — Sprint 1 built inventory, verification run
- `project-context/2.build/backend.md` — Architecture/Files, Execution controls, Temporal
  safety, Enabling the sdk engine, Known gaps, BE-OQ-2
- `.claude/rules/adapter-claude-agent-sdk.md` — Setup, Execution, Tools, Logging, Failure Policy
- `.claude/rules/aamad-core.md` — Agent Contract, State and Output, Security and Compliance
- `aamad.config.yml`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`,
  `.env.example`, `.gitignore`, `.claude/settings.json`, `README.md`
- Code read for the env contract: `server/runtime/config.ts`, `server/data/duckdb.ts`,
  `server/data/dateShift.ts`, `app/api/health/route.ts`, `app/api/chat/route.ts`,
  `lib/chatClient.ts`, `packages/shared/src/dto.ts`
- Live commands: `node -v`, `npm -v`, `npx tsc -v`, `npm ls --depth=0`, `npm run typecheck`,
  `npm run test:invariants`, `git check-ignore -v`, `git ls-files`, `curl` against
  `/api/health` and `/api/chat` on the pre-existing dev server (port 3111)

## Assumptions

1. **Node ≥ 20 is the floor, 25.9.0 is the verified version.** No `engines` field or `.nvmrc`
   exists (SG-5), so the floor is inferred from Next 16's published requirement, not asserted
   by this repo. Only 25.9.0 is actually exercised.
2. **`npm ci` is equivalent to the recorded state.** Asserted from `package-lock.json`, not
   re-verified — a clean install was out of scope for this pass.
3. **`.env.local` contents are unknown.** It exists and is ignored; that is all that was
   checked. The running server's `sdkEngineConfigured: true` implies `ANTHROPIC_API_KEY` is
   set there, and `engine: "deterministic"` implies `CHAT_ENGINE` is not `sdk`. Whether
   `NOVAMART_DUCKDB_PATH` or `AS_OF_DATE` are set locally is not known; the observed
   `asOf = 2026-08-23` is consistent with `AS_OF_DATE` being unset.
4. **The dev server on port 3111 was started by the operator**, not by AAMAD tooling. It was
   used read-only for verification and deliberately left running.
5. **Python is optional.** `scripts/build-ci-fixture.py` was not executed; the `.venv/` on
   disk is assumed to be its environment.
6. `data/fixtures/novamart_ci.duckdb` measures 3,158,016 bytes on disk (3.0 MiB / 3.2 MB
   decimal). SAD-OQ-6 quotes "3.2 MB"; same file, different unit convention.

## Open Questions

| ID | Question | Owner |
|----|----------|-------|
| **SU-OQ-1** | **`backend.md` Execution controls table is stale.** Line 153 still lists `temperature` / `MODEL_TEMPERATURE` (default 0.2) and line 152 lists `maxThinkingTokens` default `1024`; `server/runtime/config.ts` has no `MODEL_TEMPERATURE` at all and defaults `MAX_THINKING_TOKENS` to **unset/adaptive**. `BE-OQ-2` (backend.md:374) records the resolution correctly, so the artifact contradicts itself. `backend.md` is not this persona's to edit. | `@backend.eng` |  **RESOLVED 2026-08-23** — `backend.md` reconciled with `config.ts`: the Execution controls table, Known gaps §2, the trace description and the Audit row now record `effort` / `thinking` and state that `temperature` was removed from the Messages API. No stale `MODEL_TEMPERATURE` remains outside the resolution notes.
| **SU-OQ-2** | **SAD §2 mandates "temperature ≤ 0.2"**, which is now unimplementable — the parameter does not exist on current models. Needs a one-line amendment naming `effort` / `MODEL_EFFORT` instead. Already raised as BE-OQ-2 and repeated here because Setup documents the env contract. | `@system.arch` |
| **SU-OQ-3** | **SAD §5 environment matrix, `ci` row** still names `data/fixtures/novamart_practice.duckdb` as the integration fixture. SAD-OQ-6 (same document, resolved 2026-08-13) supersedes this with `novamart_ci.duckdb`, and the code and `.gitignore` follow SAD-OQ-6. Intra-document inconsistency only; the decision is settled and is **not** reopened here. | `@system.arch` |
| **SU-OQ-4** | Should `zod@4.4.3` be promoted to a direct dependency now (SG-1), or is the `sdk` engine's dependency on it acceptable while that engine remains unvalidated? Requires an install, which needs operator authorisation. | Operator / `@project.mgr` |
| **SU-OQ-5** | `aamad.config.yml` declares `style_guide: eslint` but no linter is installed (SG-3). Install ESLint under Setup, or fold it into `@devops.eng`'s CI scaffolding? | Operator / `@devops.eng` |
| **SU-OQ-6** | Which port is canonical? README and backend.md say `3000`; the operator's dev server runs on `3111`. No default is pinned in `package.json` or `.env.example` (`PORT` is declared but empty). Worth settling before the Deliver runbook fixes a health-check URL. | Operator / `@devops.eng` |
| **SU-OQ-7** | `NEXT_PUBLIC_USE_MOCK_STREAM` is now declared, but nothing prevents it being `1` in a production build, where it is baked into the client bundle and silently serves fake answers. Should the build fail when it is set outside development? | `@qa.eng` / `@devops.eng` |

## Audit

| Field | Value |
|-------|-------|
| Persona id | `project-mgr` (`@project.mgr`) |
| Action | `*setup-project` (with `*configure-env`, `*document-setup`) |
| Timestamp | **2026-08-23T19:50:40Z** (`date -u`) |
| Resolved `AAMAD_TARGET_RUNTIME` | **`claude-agent-sdk`** — from `.claude/settings.json` → `env`, matching `aamad.config.yml:12`. Env takes precedence per `aamad-core`; both agree, so no conflict. |
| Mode | **Retrospective documentation pass.** The project pre-existed, was installed, and ran; this records the as-built state. |
| Inputs | `prd.md`, `sad.md`, `frontend.md`, `backend.md`, `adapter-claude-agent-sdk.md`, `aamad-core.md`, `aamad.config.yml`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `.env.example`, `.gitignore`, `.claude/settings.json`, `server/runtime/config.ts` and the source files listed under Sources |
| Outputs | `project-context/2.build/setup.md` (new); `.env.example` (+1 name, no value); `data/policy/.gitkeep` (new dir) |
| Not modified | `package.json`, `package-lock.json`, `prd.md`, `sad.md`, `frontend.md`, `backend.md`, and all of `app/`, `lib/`, `server/`, `packages/` |
| Secrets | `.env.local` confirmed to exist and to be ignored at `.gitignore:7`; **never opened**. No secret value appears in this artifact. `.env.example` remains names-only. |
| Model / determinism controls | No model was invoked by the verification in this artifact. The documented app defaults are `MODEL_EFFORT=low`, `MAX_OUTPUT_TOKENS=4096`, `MAX_MODEL_TURNS=12`, `MAX_HOPS=4`, `TURN_TIMEOUT_MS=60000`, thinking adaptive. No `temperature` exists on current models. |
| Spend | **Zero.** No Anthropic API request was made. The `sdk` engine was never selected; the smoke test ran on the keyless deterministic engine and health was checked first to confirm it. |
| Quality gate | PASS — `typecheck` exit 0; `test:invariants` 9/9; deterministic turn end-to-end green; repo hygiene clean; env contract reconciled with 1 drift found and fixed. |
| Handoff | `@integration.eng` (`*integrate-api`) and `@qa.eng` (`*qa`). SG-3/SG-4/SG-6 carry to `@devops.eng`; SG-9 to `@security.eng`. SU-OQ-1 to `@backend.eng`; SU-OQ-2/SU-OQ-3 to `@system.arch`. |
