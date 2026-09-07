/**
 * `/` — the customer surface.
 *
 * The whole chat column lives in `components/ChatApp.tsx`, which this route and `/final` both
 * mount. This file is a shim on purpose: the two surfaces differ by exactly one prop, and the
 * moment they differ by a whole copied file they start differing by accident too.
 *
 * No `forceDemo` here. Demo mode still reaches this route the way it always has — the server's
 * `DEMO_MODE` env var read back from /api/health, or `?demo=1` on the URL — so nothing about
 * the existing deployment or the existing demo links changes.
 */

import ChatApp from "@/components/ChatApp";

export default function Page() {
  return <ChatApp />;
}
