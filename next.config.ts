import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 appends a block to AGENTS.md on `next dev`; this repo's AGENTS.md is an AAMAD
  // artifact, so opt out rather than let the tool edit it.
  agentRules: false,
  // Pin the workspace root: the repo sits next to other lockfiles.
  turbopack: { root: import.meta.dirname },
  // @duckdb/node-api is a native addon: keep it external to the server bundle (ADR-05/ADR-09).
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
