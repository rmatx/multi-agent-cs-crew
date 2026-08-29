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
    PORT=3000 \
    # Writable state lives under /app/data, which the compose file mounts as a volume.
    SESSION_DB_PATH=/app/data/sessions.sqlite \
    TICKET_STUB_DB_PATH=/app/data/ticket_stubs.sqlite

# `next start` needs the build output, the runtime deps and the config — not the source.
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

# Read-only data the app cannot start without: the committed 3.2 MB CI fixture (ADR-12), the
# policy corpus the crew answers from, and the single demo-overlay persona (ADR-14).
COPY --from=build /app/data/fixtures/novamart_ci.duckdb ./data/fixtures/novamart_ci.duckdb
COPY --from=build /app/data/policy ./data/policy
COPY --from=build /app/data/demo_overlay.json ./data/demo_overlay.json

# Writable state, owned by the unprivileged user the image runs as. The `node` user ships
# with the base image; running as root would give a support chatbot more of the host than a
# support chatbot needs.
RUN mkdir -p /app/data /app/project-context/2.build/logs \
 && chown -R node:node /app/data /app/project-context
USER node

EXPOSE 3000

# Uses the app's own health endpoint, which checks the DuckDB read AND both SQLite stores —
# a container whose data volume mounted read-only would otherwise look healthy right up to
# the moment a customer asked for a human. `node -e` rather than curl: the slim image has no
# curl, and adding one to run a health check is a package to patch forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
