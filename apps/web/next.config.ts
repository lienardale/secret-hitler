import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

// Builds run from apps/web (npm -w, and Vercel's root directory), so the
// monorepo root is two levels up. Pinning it stops Next from guessing the
// workspace root from a stray lockfile higher up (/Users/alienard/Code has one)
// and lets output tracing include packages/*.
const monorepoRoot = path.resolve(process.cwd(), "../..");

/**
 * Content-Security-Policy. `connect-src` names the rooms Worker (HTTP for the
 * health check, WS for rooms). React's development build needs 'unsafe-eval';
 * production never gets it. App icons (/icon.svg, /app-icons/*.png) are
 * same-origin images, covered by `img-src 'self'`.
 */
function contentSecurityPolicy(): string {
  const rooms = new URL(
    process.env.ROOMS_PUBLIC_URL || process.env.ROOMS_URL || "http://localhost:8787",
  );
  const ws = `${rooms.protocol === "https:" ? "wss:" : "ws:"}//${rooms.host}`;
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (process.env.NODE_ENV !== "production") scriptSrc.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${rooms.origin} ${ws}`,
    // Installable web app: app/manifest.ts and the service worker public/sw.js.
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const config: NextConfig = {
  reactStrictMode: true,
  // `next dev` writes an AGENTS.md when it detects an AI coding agent; this repo has CLAUDE.md.
  agentRules: false,
  // Internal workspace packages ship TypeScript source, not built JS.
  transpilePackages: ["@sh/engine", "@sh/protocol"],
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
      {
        // The service worker must never sit in an HTTP cache: a fixed worker has
        // to reach every visitor at their next page load.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
