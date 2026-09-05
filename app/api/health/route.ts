/**
 * GET /api/health — SAD §4 "API contracts (normative)".
 *
 * `{ status, runtime, duckdb, stores, version }` plus the resolved engine, so a deploy smoke
 * check can tell a keyless deterministic demo from a configured sdk run without reading logs.
 * Never reports a secret as a value — only whether the sdk engine would be able to start and
 * whether the operator trace is switched on.
 */

import { getMaxOrderDate } from "@/server/data/duckdb";
import { sessionDb, ticketStubDb } from "@/server/data/sqlite";
import { demoModeEnabled, preflightSdkEngine, resolveEngineId } from "@/server/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let duckdb: "ok" | "error" = "ok";
  try {
    await getMaxOrderDate();
  } catch (err) {
    console.error("health: duckdb read failed", err);
    duckdb = "error";
  }

  // The writable stores (ADR-10). A deploy where DuckDB reads fine but the SQLite volume is
  // read-only would take every turn to the point of opening a ticket and fail there — the
  // worst possible place — so the smoke check covers it.
  let stores: "ok" | "error" = "ok";
  try {
    sessionDb().prepare("SELECT count(*) AS n FROM sessions").get();
    ticketStubDb().prepare("SELECT count(*) AS n FROM ticket_stubs").get();
  } catch (err) {
    console.error("health: sqlite store check failed", err);
    stores = "error";
  }

  const engine = resolveEngineId();
  const preflight = preflightSdkEngine();
  const healthy = duckdb === "ok" && stores === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      runtime: "claude-agent-sdk",
      duckdb,
      stores,
      engine,
      sdkEngineConfigured: preflight.ok,
      // Whether the operator trace is reachable at all — never the key itself.
      operatorTrace: (process.env.OPERATOR_KEY?.trim().length ?? 0) > 0 ? "enabled" : "disabled",
      /*
       * Whether this deployment serves the demo surface (crew strip, scenario picker, handoff
       * packet). Reported from HERE, and not read from `NEXT_PUBLIC_DEMO_MODE` in the browser,
       * because that variable is baked by `next build` and is inert at run time — setting it in
       * a compose file or a platform's variable table changes nothing in a built image. This is
       * an ordinary server env var, so an operator flips the demo surface on a running
       * deployment by setting `DEMO_MODE=1` and restarting, with no rebuild.
       *
       * Safe to report unauthenticated: it says which surface is served, not who may use it.
       */
      demoMode: demoModeEnabled(),
      version: process.env.npm_package_version ?? "1.0.0",
    },
    { status: healthy ? 200 : 503 },
  );
}
