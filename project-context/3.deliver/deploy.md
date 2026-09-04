# Deploy — NovaMart Multi-Agent Support Crew

Persona: `@devops.eng` · Actions: `*prepare-release`, `*define-deploy`, `*configure-cicd`, `*document-deploy`
Epic reference: `.claude/rules/delivery-workflow.md` · SAD §5 Physical / Deployment Architecture

---

## Release readiness (`*prepare-release`)

### Phase gate

| Prerequisite | Status |
|---|---|
| `qa.md` documents MVP verification | **Met** — full QA pass 2026-08-29: 55/55 acceptance criteria mapped (46 pass, 5 partial, 1 not covered), **no defect open** |
| `security.md` from `@security.eng` | **Met** — 2 High, 2 Medium, 2 Low, 5 Info-pass, **no Critical** |
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
| `npm test` | **143 / 143** |
| `npm run test:invariants` | **9 / 9** — zero money tools registered |
| `npm run eval:sdk` | **114 / 114** across 9 scripts, green on consecutive runs |
| `npx next build` | compiles; 4 API routes + the chat page |
| Integration re-verification | **18 executed cases**, both engines |

### Known gaps shipping with this release

**No defect is open against this release.** DEF-07, DEF-08 and INT-03 were all closed on
2026-08-29, along with the device / app-version coverage gap that had three acceptance criteria
failing for one reason. What ships knowingly incomplete is scope, not defects:

- **SEC-01 / SEC-02** (`security.md`) — no authentication, and a conversation id is a bearer
  token for that conversation's history. Accepted risks, **and they decide the deployment
  shape** — see Access control below. This is the one entry an operator must read before
  choosing where to run it.
- **Five partial acceptance criteria** (`qa.md`): citation precision, per-hop latency in the
  trace, and `alignMaxDateToToday` missing from the trace panel. All cosmetic or diagnostic;
  none changes an answer a customer receives.
- **Layer 5 leftovers**: no pause/cancel controls, and no operator console around the trace
  endpoint — the route exists and is authenticated, but nothing renders it.
- **Never measured**: the PRD's ≥5-concurrent-chats and turn p95 < 30 s targets. Nothing has
  run more than one turn at a time. Recorded so nobody reads the green suites as evidence of
  something they never tested.

---

## Deploy definition (`*define-deploy`)

### What ships

| Artifact | Purpose |
|---|---|
| `Dockerfile` | Three-stage build; runtime layer carries no build toolchain and no dev deps |
| `docker-compose.yml` | The demo stack: one service, one named volume, loopback port binding |
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

### Running it

```bash
# Keyless demo — deterministic engine, no API key, no spend.
docker compose up --build

# The crew. Secrets come from .env.local, which is never copied into the image.
CHAT_ENGINE=sdk AS_OF_DATE=2026-09-01 docker compose up --build
```

`docker-compose.yml` uses the `env_file: [{ path, required }]` form, which needs Compose
v2.24 or newer. On older Compose, replace it with a bare `env_file: [.env.local]` and create
the file first — the bare form fails when it is missing.

---

## CI (`*configure-cicd`)

`.github/workflows/ci.yml`. Two jobs, **no deploy step** — the delivery workflow permits
configuration only, and promotion is manual (below).

| Step | Guards |
|---|---|
| Typecheck | strict TS across app, server and lib |
| **Zero-money-tools invariant** | NFR-SAFE-01, named as its own step so a failure reads as a safety regression rather than a test blip |
| Unit tests | 92 tests, server + client |
| Production build | catches what typecheck alone does not |
| Fixture sanity | asserts the five MVP tables' exact row counts — a truncated fixture would make everything else pass against data the demo does not use |
| Policy corpus present | AC-FAQ-04; an empty corpus turns every policy question into an escalation, which reads as a routing bug rather than missing content |
| Secret scan | cheap backstop for the one mistake that cannot be undone once pushed |
| Container build | proves the image builds; **nothing is pushed** |

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
| Health | `GET /api/health` → `{ status, duckdb, stores, engine, sdkEngineConfigured, operatorTrace }` |
| Healthy | HTTP 200 and `status: "ok"` |
| Degraded | HTTP 503 when the DuckDB read **or** either SQLite store fails |
| State | named volume at `/app/data` |
| Logs | `project-context/2.build/logs/<conversationId>.jsonl`, bind-mounted |

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
| `SESSION_DB_PATH` | `data/sessions.sqlite` | `/app/data/sessions.sqlite` | Set in the image |
| `TICKET_STUB_DB_PATH` | `data/ticket_stubs.sqlite` | `/app/data/ticket_stubs.sqlite` | Set in the image |
| `NOVAMART_DUCKDB_PATH` | optional | unset | Points at the 151 MB practice DB locally |
| `HOLIDAY_API_BASE_URL` / `HOLIDAY_TIMEOUT_MS` | unset | unset | Defaults to `date.nager.at`, 3 s |
| `NEXT_PUBLIC_USE_MOCK_STREAM` | unset | **unset** | Client-inlined at build time — never put a secret in a `NEXT_PUBLIC_*` var |

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

**This deployment is single-operator and loopback-bound, and that is a control rather than a
default.** `docker-compose.yml` publishes `127.0.0.1:3000:3000`. Changing it to `3000:3000`
exposes the app on every interface and turns two accepted risks into live ones:

- **SEC-01** — no authentication. Any caller can read any customer's order by id, and ids are
  sequential integers.
- **SEC-02** — a conversation id is a bearer token for that conversation's transcript and
  identity.

Neither has a configuration fix. The fix is authentication, which is a PRD/SAD change.
**If this demo is ever to be shared as a URL, stop and revisit `security.md` first.**

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

- **Authentication** — the prerequisite for any shared deployment (SEC-01, SEC-02)
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
