import { connect } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { parse as parseDotenv } from "dotenv";
import {
  defineConfig,
  type TestProjectInlineConfiguration,
  type ViteUserConfig,
} from "vitest/config";

/**
 * Three projects:
 *   unit         node   tests/unit/**, lib/**              pure logic (stores, env, cookies, auth rules…)
 *   ui           jsdom  components/**, tests/ui/**         React Testing Library + jest-dom
 *   integration  node   tests/integration/**               real Postgres `_test` database, one file at a time
 *
 * The integration tier always runs in CI and under scripts/ci.sh (VITEST_REQUIRE_DB=1),
 * where a missing database fails the run. On a laptop without Docker a plain
 * `npm test` drops it with a warning instead of failing every unit test.
 */
const root = import.meta.dirname;

function testDatabaseUrl(): string | undefined {
  const fromShell = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (fromShell) return fromShell;
  const file = path.join(root, ".env.test");
  if (!existsSync(file)) return undefined;
  const parsed = parseDotenv(readFileSync(file));
  return parsed.POSTGRES_URL_NON_POOLING ?? parsed.POSTGRES_URL;
}

function isPortOpen(host: string, port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function integrationTierEnabled(): Promise<boolean> {
  if (process.env.VITEST_REQUIRE_DB === "1" || process.env.CI) return true;
  if (
    process.argv.some(
      (arg, i) =>
        arg === "--project=integration" ||
        (arg === "--project" && process.argv[i + 1] === "integration"),
    )
  ) {
    return true;
  }
  const cache = globalThis as typeof globalThis & { __shIntegrationTier?: Promise<boolean> };
  cache.__shIntegrationTier ??= (async () => {
    const url = testDatabaseUrl();
    if (!url) return true; // the setup explains what is missing
    let host: string;
    let port: number;
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      port = Number(parsed.port || 5432);
    } catch {
      return true;
    }
    if (await isPortOpen(host, port)) return true;
    console.warn(
      `\n⚠ vitest: integration tier SKIPPED — nothing listens on ${host}:${port}.\n` +
        "  Start it with `npm -w @sh/web run db:up`, or set VITEST_REQUIRE_DB=1 to make this an error.\n",
    );
    return false;
  })();
  return cache.__shIntegrationTier;
}

export default defineConfig(async (): Promise<ViteUserConfig> => {
  const withIntegration = await integrationTierEnabled();
  return {
    plugins: [react()],
    resolve: { alias: { "@": root } },
    test: {
      unstubEnvs: true,
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["tests/unit/**/*.test.ts", "lib/**/*.test.ts"],
            setupFiles: ["tests/setup.node.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "ui",
            environment: "jsdom",
            include: ["tests/ui/**/*.test.tsx", "components/**/*.test.tsx"],
            setupFiles: ["tests/setup.dom.ts"],
          },
        },
        ...(withIntegration
          ? [
              {
                extends: true,
                test: {
                  name: "integration",
                  environment: "node",
                  include: ["tests/integration/**/*.test.ts"],
                  setupFiles: ["tests/setup.node.ts", "tests/setup.integration.ts"],
                  globalSetup: ["tests/integration/global-setup.ts"],
                  // One database, emptied before each file: files never overlap.
                  fileParallelism: false,
                  pool: "forks",
                  testTimeout: 20_000,
                  hookTimeout: 30_000,
                },
              } satisfies TestProjectInlineConfiguration,
            ]
          : []),
      ],
    },
  };
});
