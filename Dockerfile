# NovaMart support crew — demo image (SAD §5 "demo: one container/VM").
#
# Node 24 is not a style choice: `server/data/sqlite.ts` uses the BUILT-IN `node:sqlite`
# driver (ADR-10), which needs Node ≥ 22.5 and is only stable from 24. That choice is what
# keeps the durable-store layer at zero dependencies, so the base image has to honour it.
#
# Three stages so the runtime layer carries no build toolchain and no dev dependencies.

# ---------------------------------------------------------------- deps ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` for a lockfile-exact install — a deploy that resolves versions afresh is not the
# thing that was tested.
RUN npm ci

# --------------------------------------------------------------- build ----
FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ------------------------------------------------------------- runtime ----
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    # A default, not a binding. Railway and most platforms inject their own PORT at run time
    # and `next start` reads it; this only decides what happens when nobody says.
    PORT=3000 \
    # WRITABLE state lives in /app/var. READ-ONLY data stays in /app/data. They are separate
    # directories for one reason: /app/data holds the DuckDB fixture and the policy corpus,
    # copied in below, and a volume mounted over it would MASK them. A Docker named volume
    # hides that mistake by seeding itself from the image on first use; a Railway or Fly volume
    # starts EMPTY, so the app would boot with no fixture and no corpus. Mount the volume on
    # /app/var and nothing read-only is ever covered.
    #
    # All four writable things agree on it — a platform that gives you one volume gives you one.
    NOVAMART_STATE_DIR=/app/var \
    SESSION_DB_PATH=/app/var/sessions.sqlite \
    TICKET_STUB_DB_PATH=/app/var/ticket_stubs.sqlite \
    TRACE_LOG_DIR=/app/var/logs

# `next start` needs the build output, the runtime deps and the config — not the source.
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

# Static assets Next serves from `public/` — currently the demo run sheet the `/final` reviewer
# build links to. Easy to forget: `next build` does NOT fold `public/` into `.next`, so without
# this line the app boots healthy and the download 404s, which is exactly the kind of fault that
# only shows up in front of the person you built the link for.
COPY --from=build /app/public ./public

# Read-only data the app cannot start without: the committed 3.2 MB CI fixture (ADR-12), the
# policy corpus the crew answers from, and the single demo-overlay persona (ADR-14).
COPY --from=build /app/data/fixtures/novamart_ci.duckdb ./data/fixtures/novamart_ci.duckdb
COPY --from=build /app/data/policy ./data/policy
COPY --from=build /app/data/demo_overlay.json ./data/demo_overlay.json

# Writable state, owned by the unprivileged user the image runs as. The `node` user ships
# with the base image; running as root would give a support chatbot more of the host than a
# support chatbot needs.
#
# NOTE for whoever attaches a volume: the mount must be writable by uid 1000 (`node`). Some
# platforms attach volumes owned by root, which makes an unprivileged container fail on first
# write rather than at mount time — a container that starts and then cannot open a ticket.
# Verify with `ls -ld /app/var` inside the running container before calling a deploy done.
RUN mkdir -p /app/var/logs /app/var/tickets \
 && chown -R node:node /app/var
COPY --from=build /app/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# NOTE: no `USER node` here, and that is not a regression. The entrypoint starts as root only
# long enough to make the mounted volume writable, then hands the app to `node` via setpriv —
# see docker-entrypoint.sh. The application process runs unprivileged either way; what changed
# is that a root-owned volume is now fixed instead of being a 503 nobody can explain.

EXPOSE 3000

# Uses the app's own health endpoint, which checks the DuckDB read AND both SQLite stores —
# a container whose data volume mounted read-only would otherwise look healthy right up to
# the moment a customer asked for a human. `node -e` rather than curl: the slim image has no
# curl, and adding one to run a health check is a package to patch forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
