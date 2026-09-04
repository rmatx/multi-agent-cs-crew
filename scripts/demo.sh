#!/usr/bin/env bash
# The full end-to-end demo: real crew, live Arize traces, demo picker, handoff artifacts.
#
# COSTS API USAGE. Every turn is a real model call (~$0.19 of computed usage). For a rehearsal
# that spends nothing, run `npm run dev` instead — the keyless engine gives the same UI, the
# same demo picker, and the same ticket/outbox artifacts, just without the crew.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] && set -a && . ./.env.local && set +a

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is not set — the crew cannot run without it}"

export CHAT_ENGINE=sdk
export AS_OF_DATE="${AS_OF_DATE:-2026-09-01}"   # pin, or the run-sheet day counts stop matching
export SDK_STREAM_MODE=live                      # default is `final`: 15s of silence, then a lump
export OPERATOR_KEY="${OPERATOR_KEY:-demo-secret}"
export NEXT_PUBLIC_DEMO_MODE=1
# Server-side gate for the handoff-email endpoint (ENH-01). Separate from the NEXT_PUBLIC_ flag
# above, which is inlined into the browser bundle and is therefore not a control.
export DEMO_MODE=1

cat <<BANNER

  NovaMart — full demo
  ────────────────────────────────────────────────────────────────
  App          http://localhost:3000/?demo=1
  Trace panel  add &trace=1, or tick Trace
BANNER

if [ -n "${ARIZE_API_KEY:-}" ] && [ -n "${ARIZE_SPACE_ID:-}" ]; then
  echo "  Arize        https://app.arize.com  →  project ${ARIZE_PROJECT_NAME:-novamart-support-crew}"
else
  echo "  Arize        OFF (set ARIZE_API_KEY + ARIZE_SPACE_ID in .env.local)"
fi

cat <<BANNER
  Handoffs     data/outbox.md  ·  data/tickets/<STUB-ID>.md
  After        npm run observability
  ────────────────────────────────────────────────────────────────
  Each turn is a real model call. Rehearse with \`npm run dev\` (free).

BANNER

exec npm run dev
