/**
 * GET /api/health — SAD §4 "API contracts (normative)".
 *
 * `{ status, runtime, duckdb, version }` plus the resolved engine, so a deploy smoke check
 * can tell a keyless deterministic demo from a configured sdk run without reading logs.
 * Never reports whether a key is present as a value — only whether the sdk engine would be
 * able to start.
 */

import { getMaxOrderDate } from "@/server/data/duckdb";
import { preflightSdkEngine, resolveEngineId } from "@/server/runtime/config";

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

  const engine = resolveEngineId();
  const preflight = preflightSdkEngine();

  return Response.json(
    {
      status: duckdb === "ok" ? "ok" : "degraded",
      runtime: "claude-agent-sdk",
      duckdb,
      engine,
      sdkEngineConfigured: preflight.ok,
      version: process.env.npm_package_version ?? "1.0.0",
    },
    { status: duckdb === "ok" ? 200 : 503 },
  );
}
