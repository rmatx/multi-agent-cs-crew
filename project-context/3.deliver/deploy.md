# Deploy — NovaMart Multi-Agent Support Crew

Persona: `@devops.eng` · Actions: `*prepare-release`, `*define-deploy`, `*configure-cicd`, `*document-deploy`
Epic reference: `.claude/rules/delivery-workflow.md` · SAD §5 Physical / Deployment Architecture

---

## Release readiness (`*prepare-release`)

### Phase gate

| Prerequisite | Status |
|---|---|
| `qa.md` documents MVP verification | **Met** — full QA pass 2026-08-29, re-verified 2026-09-04: 55/55 acceptance criteria mapped (46 pass, 5 partial, 1 not covered). **One defect open and accepted (DEF-14)**, a cautious retrieval failure, not a wrong answer |
| `security.md` from `@security.eng` | **Met** — 2 High, 2 Low, 5 Info-pass, **no Critical**; both Medium findings (SEC-03, SEC-04) closed 2026-09-04 |
| `backend.md`, `frontend.md`, `integration.md` | **Met** |
| PRD + SAD including DevOps/Deployment Architecture | **Met** |

`aamad.config.yml` sets `security.require_security_assessment: true`; the assessment exists, so
the gate is satisfied rather than waived. **No Diagnostic raised.**

### What is being released

`1.0.0` — the Sprint 2 build: six registered agents, nine tools, durable stores, operator
trace, CSAT, and the UI for all of it.

| Evidence | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | **170 / 170** |
| `npm run test:invariants` | **9 / 9** — zero money tools registered |
| `npm run eval:sdk` | **114 / 114** across 9 scripts, green on consecutive runs — re-run 2026-09-04 against the release build |
| `npx next build` | compiles; 4 API routes + the chat page |
| Integration re-verification | **18 executed cases**, both engines |
| `npm run evals` (golden dataset) | **26 / 26**, every category at or above threshold; both SAFETY categories **100%** |
| Security headers | Verified live on the production build, page **and** API routes (SEC-04) |

### Known gaps shipping with this release

**One defect is open against this release, and it is accepted.** DEF-07, DEF-08 and INT-03 closed
2026-08-29; DEF-09, DEF-10, DEF-11, DEF-12 and DEF-13 all closed 2026-09-04. What remains:

- **DEF-14 (Low, accepted)** — a correct top-1 policy retrieval is rejected by the 0.55 grounding
  gate when the agent's query mixes in a term from an adjacent section. Measured at **1 turn in 5**
  on the return-processing path. It fails *cautiously*: the customer reaches a human and nothing
  wrong is said. Not fixed here because every candidate fix touches ADR-11's normative threshold,
  which is an architecture decision rather than a deploy one. `qa.md` carries a repro that needs no
  model to reproduce.

What else ships knowingly incomplete is scope, not defects:

- **SEC-01 / SEC-02** (`security.md`) — no authentication, and a conversation id is a bearer
  token for that conversation's history. Accepted risks, **and they decide the deployment
  shape** — see Access control below. This is the one entry an operator must read before
  choosing where to run it.
- **Five partial acceptance criteria** (`qa.md`): citation precision, per-hop latency in the
  trace, and `alignMaxDateToToday` missing from the trace panel. All cosmetic or diagnostic;
  none changes an answer a customer receives.
- **Layer 5 leftovers**: no pause/cancel controls, and no operator console around the trace
  endpoint — the route exists and is authenticated, but nothing renders it.
- **The image is now built and run**, on 2026-09-04, for the first time outside CI — six agent
  paths exercised through the container, and state verified to survive a container destroy/recreate
  (6 sessions, 6 traces, 1 ticket, all intact). Finding it required a real Docker host; CI builds
  the image and never starts it, which is how DEF-15 and DEF-16 stayed hidden behind a green job.
- **Half measured**: the PRD's turn p95 < 30 s target is **met at single-user load — p95 28.2 s
  over 514 turns**, error rate 0.0%. The **≥5-concurrent half has still never been run**. Nothing
  in this project has ever had two turns in flight at once, and since latency is dominated by the
  model hop rather than the data layer (tool p95 ≤ 12 ms), concurrency is more likely to erode
  that 28.2 s than to reveal headroom. Recorded so nobody reads the green suites as evidence of
  something they never tested.

---

## Deploy definition (`*define-deploy`)

### What ships

| Artifact | Purpose |
|---|---|
| `Dockerfile` | Three-stage build; runtime layer carries no build toolchain and no dev deps |
| `docker-compose.yml` | The demo stack: one service, one named volume, loopback port binding |
| `docker-compose.prod.yml` | The production stack: sdk engine, published on every interface, volume on `/app/var` |
| `docker-entrypoint.sh` | Makes a root-owned platform volume writable, then drops to `node` |
| `railway.json` | Dockerfile builder + `/api/health` healthcheck; `numReplicas` pinned to 1 |
| `.dockerignore` | Keeps secrets, customer data and traces out of the image layers |
| `.nvmrc` | `24` — pinned, and load-bearing (below) |

### Three choices worth stating

**Node 24, not "whatever is current".** `server/data/sqlite.ts` uses the built-in `node:sqlite`
driver, which needs Node ≥ 22.5 and is only stable from 24. That choice is what keeps the
durable-store layer at **zero added dependencies** (ADR-10), so the base image has to honour
it. `.nvmrc`, the Dockerfile and the CI workflow all read the same pin; if one moves, all three
must.

**`next start`, not `output: "standalone"`.** Standalone would produce a smaller image, but the
app depends on `@duckdb/node-api`, a native addon deliberately kept out of the server bundle
(`serverExternalPackages`, ADR-05/09). Tracing a native `.node` binary into a standalone bundle
is exactly the kind of thing that works on a laptop and fails in a container at 3am. The cost
is image size; the benefit is that what runs in the container is what ran in `npm run dev`.

**The policy corpus is un-ignored explicitly.** `.dockerignore` excludes `*.md`, which by
Docker's matching rules should not reach `data/policy/*.md` — patterns do not cross a `/`. The
cost of that recollection being wrong is a container that builds and then throws on the first
policy question, because the corpus loader refuses to start empty. `!data/policy/*.md` removes
the question.

**The image is data-complete but state-empty.** It bakes in the three read-only assets the app
cannot start without — the committed 3.2 MB CI fixture (ADR-12), the policy corpus, the single
demo-overlay persona — and **no** SQLite file and **no** trace log. Those are created on first
run in a volume. An image containing one demo's conversations would ship customer content to
whoever pulls it (`security.md` SEC-03).

### Read-only vs writable, and why they are different directories

**`/app/data` is read-only. `/app/var` is writable, and the volume mounts there.**

This is the single most important thing in this section, because getting it wrong produces a
container that builds, starts, passes a casual look, and is broken. `/app/data` holds the DuckDB
fixture, the policy corpus and the demo overlay — baked into the image, never written. If a
volume is mounted over `/app/data` to persist state, it **masks** them.

A Docker *named* volume hides the mistake: Docker seeds an empty named volume from the image on
first use, so the fixture appears and everything works. A platform volume — Railway, Fly, or a
plain bind mount — **starts empty and does not seed**. Verified, same image, both ways:

| Volume mounted at | Seeding | `/api/health` |
|---|---|---|
| `/app/data`, Docker named volume | seeded from image | `200` — *the mistake is invisible* |
| `/app/data`, non-seeding mount | empty | **`503`**, `duckdb: error`, `database does not exist` |
| `/app/var`, non-seeding mount | empty | `200`, `duckdb: ok`, `stores: ok` |

Everything writable therefore agrees on `/app/var`, via four variables the image sets:
`NOVAMART_STATE_DIR`, `SESSION_DB_PATH`, `TICKET_STUB_DB_PATH` and `TRACE_LOG_DIR`. Two of those
are new: handoff artifacts (`tickets/`, `outbox.md`) had their path hardcoded to `data/`, and
trace logs to `project-context/2.build/logs`, so on any platform volume both were written to the
container's ephemeral layer and lost on the next redeploy — the failure mode of a diagnostic you
only reach for after something has gone wrong.

### The entrypoint, and why the image no longer says `USER node`

A platform volume is attached **root-owned**, and it does not inherit the image's ownership. An
app running as uid 1000 then cannot create `sessions.sqlite`. Verified on this image: with a
non-seeding mount at `/app/var` and `USER node`, health returned **`503` with `stores: error`** —
which reads like an application fault and is a mount permission.

`docker-entrypoint.sh` starts as root, creates and `chown`s **only** the state directory, then
drops to `node` with `setpriv` (util-linux, already in the base image — no `gosu` to vendor).
Verified after the change: health `200`, `/app/var` owned by `node`, and every application
process running as uid 1000 — `npm`, `sh` and `next-server` all `Uid: 1000` in `/proc`. The app
is as unprivileged as it was; what changed is that a root-owned mount is repaired instead of
being an unexplainable 503. If a platform forces a non-root uid, the entrypoint skips the chown
and **fails loudly** with the reason rather than starting into a degraded health check.

### Running it

```bash
# Keyless demo — deterministic engine, no API key, no spend. Loopback only.
docker compose up --build

# The crew, still loopback. Secrets come from .env.local, never copied into the image.
CHAT_ENGINE=sdk AS_OF_DATE=2026-09-01 docker compose up --build

# PRODUCTION — the crew, published on every interface. Read docker-compose.prod.yml's
# header first: this is the configuration SEC-01 and SEC-02 were accepted against.
docker compose -f docker-compose.prod.yml up --build -d
```

**Reading operator traces out of a running container:**

```bash
docker compose cp novamart:/app/var/logs ./project-context/2.build/logs
```

The demo stack used to bind-mount the host's log directory into the container instead. That does
not work and fails *silently*: the host directory appears root-owned inside the container, the
app runs as uid 1000, and `trace.ts` swallows write errors by design (a diagnostic must never
fail a customer's turn). Verified directly — `touch` as uid 1000 into a bind mount returns
`Permission denied`. Turns would succeed, and traces would simply never appear. Removed.

**Compose passthrough entries erase what they look like they forward — DEF-15.** Both compose
files carried lines of the form `MODEL_ID: ${MODEL_ID:-}`. Compose resolves that to an **empty
string**, and an empty value in `environment:` **overrides `env_file:`** — so `MODEL_ID` from
`.env.local` was wiped. `MODEL_ID` is required with no default by design (`config.ts`: a
silently-chosen model makes the Audit line a lie), so the effect was that **`CHAT_ENGINE=sdk`
could not start the crew through compose at all**: `/api/health` reported
`sdkEngineConfigured: false` with the key present and valid. Observed while bringing the
production stack up, then fixed in both files by deleting every empty-default passthrough.
Anything not given a real default now reaches the container from `.env.local` or the platform.

`docker-compose.yml` uses the `env_file: [{ path, required }]` form, which needs Compose
v2.24 or newer. On older Compose, replace it with a bare `env_file: [.env.local]` and create
the file first — the bare form fails when it is missing.

### Railway

`railway.json` selects the Dockerfile builder and points the healthcheck at `/api/health`.
Railway injects `PORT`; `next start` reads it, and the Dockerfile's `PORT=3000` is only a
fallback for when nobody says.

**Attach a volume with mount path `/app/var`.** Without it the service runs, and every
conversation, ticket and trace is discarded on each redeploy. With it mounted anywhere else —
`/app/data` above all — see the table above.

Variables to set in the Railway service:

| Variable | Value | Why |
|---|---|---|
| `ANTHROPIC_API_KEY` | the key | Required by the sdk engine |
| `MODEL_ID` | e.g. `claude-sonnet-5` | **Required, never defaulted** — see DEF-15 above |
| `CHAT_ENGINE` | `sdk` | Otherwise the keyless engine answers and no specialist exists |
| `ENABLE_HSTS` | `1` | Railway terminates TLS, so HSTS is finally appropriate |
| `OPERATOR_KEY` | a secret, or unset | Gates the trace endpoint; **fails closed** (503) when unset |
| `RATE_LIMIT_PER_MIN` | `20` or lower | On a public endpoint this is all that stands between a stranger and the Anthropic bill |
| `AS_OF_DATE` | leave unset | Pinning a clock in a long-lived deployment silently ages out of the fixture |
| `DEMO_MODE` | `1` | Serves the demo surface — crew strip, 23-scenario picker, handoff packet. See below |

**`DEMO_MODE=1`, and it has to be this variable.** The demo surface was previously switched by
`NEXT_PUBLIC_DEMO_MODE`, and that cannot work on a platform: `NEXT_PUBLIC_*` is inlined by
`next build`, so the value is frozen into the image on the build machine and a platform variable
table never reaches it. Setting it in `docker-compose.prod.yml` did nothing at all — the line
read as a control and was decoration, the same shape of fault as DEF-15. Logged as **DEF-17**,
fixed by resolving `DEMO_MODE` on the server and reporting it through `/api/health`, which the
page already fetches. Verified on a build made with **no** demo flag: `DEMO_MODE=1` at run time
alone produced the full surface on a bare `/`.

`?demo=1` on the URL still works and is unchanged — and note that it always did, which is why
the surface was never actually absent from any build, only off by default.

**What `DEMO_MODE=1` publishes.** The picker lists real order ids belonging to other customers.
On this fixture those customers are fictional, which is the identical ground the operator
accepted SEC-01 and SEC-02 on for this deployment. Against real data it must be `0`, and that is
a stronger statement than it looks: `?demo=1` means the surface is reachable by anyone who types
it regardless of this variable, so `DEMO_MODE=0` is a default, not a control. Authentication is
the control, and it is still the open item.

**`numReplicas` must stay 1.** SQLite on a single volume, a per-process rate limiter and
per-process session state all assume one instance. A second replica would not share the volume
and would answer from its own store — the kind of fault that shows up as "the customer says they
already have a ticket and the bot disagrees".

**Rotate `ANTHROPIC_API_KEY` for a public deployment.** The key currently in `.env.local` is the
same one in GitHub Actions secrets; a public endpoint spending it means local dev, CI and the
internet share one blast radius.

---

## CI (`*configure-cicd`)

`.github/workflows/ci.yml`. Two jobs, **no deploy step** — the delivery workflow permits
configuration only, and promotion is manual (below).

| Step | Guards |
|---|---|
| Typecheck | strict TS across app, server and lib |
| **Zero-money-tools invariant** | NFR-SAFE-01, named as its own step so a failure reads as a safety regression rather than a test blip |
| Unit tests | 170 tests, server + client |
| Production build | catches what typecheck alone does not |
| Fixture sanity | asserts the five MVP tables' exact row counts — a truncated fixture would make everything else pass against data the demo does not use |
| Policy corpus present | AC-FAQ-04; an empty corpus turns every policy question into an escalation, which reads as a routing bug rather than missing content |
| Secret scan | cheap backstop for the one mistake that cannot be undone once pushed |
| Container build | proves the image builds; **nothing is pushed**, and nothing is *started* — DEF-15 and DEF-16 both survived this job green |

**The pipeline is keyless by design.** Every step runs against the committed fixture with no
`ANTHROPIC_API_KEY` in the environment, so a fork or a pull request can run the full suite
without a secret and without spending anyone's money.

**What CI therefore cannot cover, and who covers it.** `npm run eval:sdk` drives eight live
model turns against a running server; it needs a key, costs money, and is non-deterministic in
routing. It is the **operator's manual gate before a demo**, not a CI step — see the pre-demo
checklist below. `scripts/build-ci-fixture.py --check` is also absent from CI: it needs the
untracked 151 MB practice DB, which by design never leaves a developer's machine.

---

## Runbook (`*document-deploy`)

### Hosting

Single Node process behind one container (SAD §5 `demo`). No load balancer, no queue, no
second node. Concurrency target is ≥ 5 chats (PRD), which one process handles comfortably —
the turn is I/O-bound on the model API.

| Setting | Value |
|---|---|
| Port | 3000 (`PORT`) |
| Health | `GET /api/health` → `{ status, duckdb, stores, engine, sdkEngineConfigured, operatorTrace, demoMode }` |
| Healthy | HTTP 200 and `status: "ok"` |
| Degraded | HTTP 503 when the DuckDB read **or** either SQLite store fails |
| State | volume at **`/app/var`** — never `/app/data`, which is the read-only fixture (DEF-16) |
| Logs | `$TRACE_LOG_DIR/<conversationId>.jsonl` — `/app/var/logs` in the image, inside the volume |

The health check covers the writable stores as well as the read-only catalog, deliberately: a
deployment whose data volume mounted read-only would look healthy right up to the moment a
customer asked for a human, which is the worst possible place to discover it.

### Environment matrix

Names only — **no value in this file, ever** (`aamad-core` Security and Compliance).

| Variable | Local dev | Demo container | Notes |
|---|---|---|---|
| `CHAT_ENGINE` | `deterministic` | `deterministic` unless demoing the crew | `sdk` spends the key every turn |
| `ANTHROPIC_API_KEY` | `.env.local` | `.env.local` via `env_file` | **Required for `sdk`.** Never in the image |
| `MODEL_ID` | set | set | Required, not defaulted — a silently chosen model makes the audit line a lie |
| `MODEL_EFFORT` | unset (`low`) | `low` | The determinism lever; there is no temperature (ADR SAD-OQ-7) |
| `SDK_STREAM_MODE` | `live` for demos | `final` | `live` streams coordinator deltas |
| `AS_OF_DATE` | pin for demos | pin for demos | Unset = today; every eval must pin it |
| `OPERATOR_KEY` | optional | optional | **Unset = trace endpoint disabled (503), not open** |
| `RATE_LIMIT_PER_MIN` | unset (20) | 20 | `0` disables. A cost guard, not access control |
| `SESSION_DB_PATH` | `data/sessions.sqlite` | `/app/var/sessions.sqlite` | Set in the image |
| `TICKET_STUB_DB_PATH` | `data/ticket_stubs.sqlite` | `/app/var/ticket_stubs.sqlite` | Set in the image |
| `NOVAMART_STATE_DIR` / `TRACE_LOG_DIR` | `data/` / `project-context/2.build/logs` | `/app/var` / `/app/var/logs` | Set in the image; both inside the volume |
| `NOVAMART_DUCKDB_PATH` | optional | unset | Points at the 151 MB practice DB locally |
| `HOLIDAY_API_BASE_URL` / `HOLIDAY_TIMEOUT_MS` | unset | unset | Defaults to `date.nager.at`, 3 s |
| `DEMO_MODE` | unset | `1` to demo the crew | **The demo surface**, read at run time from `/api/health`. Off unless exactly `1` |
| `NEXT_PUBLIC_USE_MOCK_STREAM` / `NEXT_PUBLIC_DEMO_MODE` | unset | **unset — inert** | `NEXT_PUBLIC_*` is inlined at `next build`; setting either on a deployment does nothing (DEF-17). Never put a secret in one |

### Access control

**The trace-log directory holds customer content. Do not copy it off the host.**
`project-context/2.build/logs/` is one JSONL file per conversation, and the `prompt_trace`
record carries `conversation_so_far` — the customer's own words. Contact details (email, phone,
card) are scrubbed at write time by `scrubPii()`, and order ids, dates and amounts are
deliberately kept so a turn stays reconstructable, so the directory is pseudonymous rather than
anonymous. `.gitignore` prevents commit, not disclosure; anyone with host or backup access reads
these files.

Retention is **7 days by default** (`TRACE_RETENTION_DAYS`) and is enforced by running
`npm run prune:traces` — it does not happen on its own. On a host that stays up, put it on a
timer:

```cron
# 03:00 daily — enforce the trace-log retention window (SEC-03)
0 3 * * *  cd /srv/novamart && npm run prune:traces >> /var/log/novamart-prune.log 2>&1
```

The CI eval workflow uploads the same logs as a build artifact with 7-day retention, matching.
Against real customer data this is not sufficient — `security.md` SEC-03 rises to High and needs
encryption at rest and an access boundary.

**There are now two deployment shapes, and they carry different risk.**

`docker-compose.yml` publishes `127.0.0.1:3000:3000` — loopback, single-operator, and that
binding is a control rather than a default. `docker-compose.prod.yml` and Railway publish on
every interface, which turns two accepted risks into live ones:

- **SEC-01** — no authentication. Any caller can read any customer's order by id, and ids are
  sequential integers.
- **SEC-02** — a conversation id is a bearer token for that conversation's transcript and
  identity.

Neither has a configuration fix. The fix is authentication, which is a PRD/SAD change.

**Operator decision, 2026-09-04: the public shape is accepted for this deployment.** The stated
grounds are that the dataset is fictional — 50,000 generated users, no real person's data — and
that this is coursework rather than a service with customers. Recorded in `security.md` under
SEC-01/SEC-02 as an operator acceptance with a named scope, because an accepted risk that does
not say what it was accepted *for* is indistinguishable later from one nobody noticed.

**What that acceptance does not extend to.** It is scoped to this fixture. Point the same build
at real customer data and SEC-01 stops being a finding and becomes a breach: the enumeration is
trivial, the data is order history and account identity, and nothing in the app would record that
it happened. There is no code change between those two situations — only which database is
mounted — which is precisely why the boundary is written down here rather than assumed.

What is protected today:

| Surface | Control |
|---|---|
| `POST /api/chat` | None. Rate-limited only — a cost guard on an endpoint that spends the API key |
| `POST /api/conversations/:id/csat` | None. Customer surface; worst case is someone rating their own conversation |
| `GET /api/conversations/:id/trace` | `X-Operator-Key`, constant-time compare, **fails closed when unset** |
| DuckDB | Opened `READ_ONLY`; the practice DB is never written, not even for tickets |
| Money movement | No such function exists in the process. Five independent layers, one CI step |

**Secrets handling.** `ANTHROPIC_API_KEY` and `OPERATOR_KEY` reach the container through
`env_file` at run time and are excluded from the build context by `.dockerignore`. Rotate by
editing `.env.local` and restarting the service; nothing caches them. `redact()` runs over
every trace record, so a key cannot reach the log even if a future call site passes one.

**Customer data on disk.** `project-context/2.build/logs/` contains customer conversations in
plaintext (`security.md` SEC-03). Treat that directory as customer data: do not copy it off the
host, and prune it on a schedule the operator sets. `.gitignore` prevents commit, not
disclosure.

### Promotion, and rollback

Manual, by design (`delivery-workflow.md`: config only, no live deploys without explicit
operator authorization).

```bash
# 1. Verify the build you intend to promote
npm ci && npm run typecheck && npm test && npx next build

# 2. Keyless smoke, no spend
CHAT_ENGINE=deterministic docker compose up --build -d
curl -s localhost:3000/api/health          # expect status ok, stores ok
# WISMO and a refund ask — grounded answer, then a ticket
curl -Ns localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"Where is my order?","identity":{"orderId":46101}}'
curl -Ns localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"I want a refund","identity":{"orderId":46101}}'

# 3. Only if demoing the crew: the paid gate CI cannot run
CHAT_ENGINE=sdk AS_OF_DATE=2026-09-01 docker compose up -d
npm run eval:sdk                            # expect 102/102

# 4. Tag what you promoted
git tag -a v1.0.0 -m "NovaMart support crew 1.0.0" && git push --tags
```

**Rollback** is `docker compose down && git checkout <previous tag> && docker compose up
--build -d`. Two things make that safe, and one needs care:

- **The image is stateless.** All state is in the named volume, which `down` does not remove.
- **The catalog is read-only.** No rollback can corrupt it, because nothing writes it.
- **The SQLite schema is create-if-absent, with additive column migration** (added
  2026-08-29, when `sessions` gained `device` and `app_version`). On open, missing columns are
  added with `ALTER TABLE ADD COLUMN`. That is safe in both directions: an older build ignores
  a column it does not know, and a newer one backfills null. Rolling back across such a change
  leaves the newer columns in place, which SQLite tolerates. **A rename or a retype is not
  safe this way** — the first release that needs one needs a real migration path with a
  version table, and this section needs rewriting rather than extending.

To roll back the data as well — for a clean demo — `docker compose down -v` removes the volume
and the next start recreates empty stores. That destroys every ticket stub and transcript.

### Pre-demo checklist

1. `curl -s localhost:3000/api/health` → `status: ok`, `stores: ok`, and the `engine` you meant
2. Pin `AS_OF_DATE` so the walkthrough's dates are the ones in the README table
3. On `sdk`: `npm run eval:sdk` → 102/102 before anyone is watching
4. Decide `OPERATOR_KEY` — unset means the trace endpoint is off, which is a fine demo posture
5. `docker compose down -v` first if you want a clean transcript history

---

## Future work (deferred non-MVP ops)

Named so nobody re-derives them as oversights:

- **Authentication** — still the honest prerequisite for a deployment with real users. The
  operator has accepted its absence for this academic deployment on the fictional fixture
  (see Access control); that acceptance does not survive real customer data
- **Shrink the image: 1.53 GB.** It builds, deploys and runs at that size, so this is cost and
  deploy time rather than a fault. The runtime layer carries the full `node_modules` and the
  unpruned `.next`; Next's `output: "standalone"` bundles only what the server actually imports
  and typically takes an image of this shape well under 300 MB. Not done here because it changes
  what the runtime stage copies and what the start command is, and that deserves its own verified
  change rather than riding along with a security and state-path fix
- **`ANTHROPIC_API_KEY` rotation for the public deployment.** The key in `.env.local` is the same
  one in GitHub Actions secrets. A public endpoint spending it means local dev, CI and the open
  internet share one blast radius; a deployment-scoped key would separate them
- **A CI job that STARTS the container**, not just builds it. DEF-15 and DEF-16 both passed the
  existing `container` job green, because building an image proves nothing about whether it runs.
  One `docker run` plus a `curl` on `/api/health` against a non-seeding volume would have caught
  both
- Monitoring, metrics and alerting beyond `/api/health`; no APM, no dashboards
- Autoscaling, multi-node, multi-region — SAD §7 scales vertically only
- Managed Postgres for sessions and stubs; log shipping and retention automation
- Automated deploys, blue/green, canaries — promotion is manual and stays that way in MVP
- TLS termination and a reverse proxy; assumed to exist in front of any non-localhost host
- Image signing, SBOM, registry scanning
- A CI job for `eval:sdk` behind a repository secret with a spend cap

---

## Sources

- `.claude/rules/delivery-workflow.md`, `.claude/rules/adapter-claude-agent-sdk.md`,
  `.claude/rules/aamad-core.md`
- `project-context/1.define/sad.md` — §5 Physical/Deployment, §4 env var names, ADR-05, ADR-09,
  ADR-10, ADR-12
- `project-context/2.build/{qa,security,backend,frontend,integration,setup}.md`
- `aamad.config.yml` — `security.require_security_assessment`, `documentation.require_user_guide`
- Repo: `package.json`, `next.config.ts`, `.env.example`, `.gitignore`

## Assumptions

1. **Loopback-bound, single-operator hosting.** Every acceptance in `security.md` depends on
   it, and `docker-compose.yml` enforces it in the only place a reader will look.
2. TLS terminates in front of the app on any non-localhost deployment (SAD §8). Not verifiable
   from the codebase.
3. Docker Engine with Compose v2.24+ on the demo host. Older Compose needs the `env_file`
   change noted above.
4. The demo host has outbound HTTPS to `api.anthropic.com` (required for `sdk`) and, optionally,
   `date.nager.at` — the holiday call degrades rather than fails when blocked.
5. Deploy artifacts are **generated and not executed**: no image was built or pushed from this
   session, and no environment was provisioned. Docker is not installed on the authoring
   machine, so the Dockerfile and compose file are reviewed configuration, not proven builds
   (see Open Questions).
6. `1.0.0` from `package.json` is the release version; no separate version scheme exists.

## Open Questions

| ID | Question | Owner |
|---|---|---|
| DEP-OQ-1 | **The image has not been built.** Docker is unavailable on the authoring machine, so the CI `container` job is the first real test of the Dockerfile. Run it before relying on the image. | `@devops.eng` / operator |
| DEP-OQ-2 | Is the capstone demo ever shared as a URL? Answering it decides whether SEC-01/SEC-02 stay accepted (`security.md` SEC-OQ-1). | Operator |
| DEP-OQ-3 | What retention applies to the trace logs now that they hold customer conversations? Nothing prunes them today (`security.md` SEC-OQ-2). | Operator |
| DEP-OQ-4 | ~~Should `eval:sdk` run in CI behind a secret and a spend cap, or stay a manual pre-demo gate?~~ **Resolved 2026-09-04 — both.** `.github/workflows/eval.yml` runs the nine live slices on a daily schedule and on manual dispatch, never on `pull_request` (a fork PR that could trigger it could exfiltrate `ANTHROPIC_API_KEY`). The spend cap is enforced from the run's own traces by `scripts/ci-spend-gate.mjs`, default $6.00 and overridable per dispatch, and the job fails if the run exceeds it. It still deploys nothing. | Closed |

## Audit

| Field | Value |
| ----- | ----- |
| Persona | `@devops.eng` |
| Actions | `*prepare-release`, `*define-deploy`, `*configure-cicd`, `*document-deploy` |
| Timestamp | 2026-08-28; re-run 2026-08-29 |
| Resolved runtime | `AAMAD_TARGET_RUNTIME=claude-agent-sdk` (env, matches `aamad.config.yml` → `runtime.target`) |
| Adapter rule loaded | `.claude/rules/adapter-claude-agent-sdk.md` |
| Release | `1.0.0` |
| Phase gate | Satisfied — `qa.md` present with no open defect, `security.md` present with no Critical findings |
| Re-run 2026-08-29 | `*prepare-release` gate re-confirmed against the closed defects; `*define-deploy` corpus un-ignore; `*document-deploy` known-gaps rewritten now that none are defects; `*document-user-guide` corrected — it still listed INT-03 as a known defect and the eval as 102/102 |
| Deploy authorization | **Not requested and not performed.** Configuration only; no image built, pushed, or deployed |
| Files written | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.nvmrc`, `.github/workflows/ci.yml`, `project-context/3.deliver/deploy.md`, `project-context/3.deliver/user-guide.md` |
| Application logic | Unmodified. No source file under `app/`, `lib/`, `server/` or `packages/` was touched |
| Self-check | Required sections present: Sources, Assumptions, Open Questions, Audit. No Diagnostic raised |
