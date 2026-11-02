import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

// Builds run from apps/web (npm -w, and Vercel's root directory), so the
// monorepo root is two levels up. Pinning it stops Next from guessing the
// workspace root from a stray lockfile higher up (/Users/alienard/Code has one)
// and lets output tracing include packages/*.
const monorepoRoot = path.resolve(process.cwd(), "../..");

const config: NextConfig = {
  reactStrictMode: true,
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
        ],
      },
    ];
  },
};

export default withNextIntl(config);
