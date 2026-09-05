#!/bin/sh
# Prepare the writable state directory, then drop to the unprivileged `node` user.
#
# WHY THIS EXISTS. The image runs the app as uid 1000 (`node`) — a support chatbot has no
# business running as root. But a platform volume (Railway, Fly, `docker run -v` against a host
# directory) is attached ROOT-OWNED and does NOT inherit the image's ownership. An unprivileged
# process then cannot create `sessions.sqlite`, and the failure is a bad one to debug: the
# container starts, Next serves, and only /api/health says `stores: error` with a 503 that reads
# like an application fault rather than a mount permission.
#
# So: start as root, make the mount usable, and hand the app to `node` with setpriv (util-linux,
# already in the base image — no gosu to vendor). The app itself never runs as root.
#
# If the platform forces a non-root uid, there is nothing to fix and nothing to drop: verify the
# directory is writable and fail LOUDLY if it is not, rather than starting into a 503.
set -e

STATE_DIR="${NOVAMART_STATE_DIR:-/app/var}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$STATE_DIR/logs" "$STATE_DIR/tickets"
  # Only the state directory. Never a recursive chown of /app — that would rewrite node_modules
  # on every boot and turn a container start into a multi-second disk churn.
  chown -R node:node "$STATE_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

# Non-root already.
mkdir -p "$STATE_DIR/logs" "$STATE_DIR/tickets" 2>/dev/null || true
if [ ! -w "$STATE_DIR" ]; then
  echo "FATAL: $STATE_DIR is not writable by uid $(id -u)." >&2
  echo "  The volume is attached root-owned and this container was told to run unprivileged." >&2
  echo "  Fix the volume ownership, or let the image start as root so it can chown the mount" >&2
  echo "  itself and drop to 'node' (that is this entrypoint's default path)." >&2
  exit 1
fi
exec "$@"
