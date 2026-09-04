import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 appends a block to AGENTS.md on `next dev`; this repo's AGENTS.md is an AAMAD
  // artifact, so opt out rather than let the tool edit it.
  agentRules: false,
  // Pin the workspace root: the repo sits next to other lockfiles.
  turbopack: { root: import.meta.dirname },
  // @duckdb/node-api is a native addon: keep it external to the server bundle (ADR-05/ADR-09).
  serverExternalPackages: ["@duckdb/node-api"],

  /**
   * SEC-04 — security response headers.
   *
   * Defence in depth, not a fix for a live hole: React escapes by default, there is no
   * `dangerouslySetInnerHTML` anywhere in the tree, and the app is loopback-bound. But the page
   * shows a customer's order detail, and a framed page showing order detail is worth more to an
   * attacker than a framed marketing page.
   *
   * A CSP is deliberately NOT here. Next's inline bootstrap needs either a nonce or
   * `unsafe-inline`, and a policy that ships `unsafe-inline` to look compliant is worse than an
   * absent one, because it reads as protection that is not there. security.md records it as
   * deliberate rather than forgotten.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Clickjacking. DENY rather than SAMEORIGIN: nothing in this build frames itself.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The trace endpoint takes a conversation id in the PATH, and a conversation id is a
          // bearer token for that transcript (SEC-02). Leaking it in a Referer to any outbound
          // link would hand a stranger the conversation, so no referrer leaves this app at all.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            // Named explicitly rather than left to a default: this app asks for none of them,
            // and saying so is what makes a later request for one visible in review.
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          /*
           * HSTS is conditional, and the condition matters. Sent over plain HTTP it is ignored;
           * sent from a localhost demo it would pin a developer's browser to HTTPS for a host
           * that does not serve it. It ships only where TLS actually terminates in front.
           */
          ...(process.env["ENABLE_HSTS"] === "1"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
