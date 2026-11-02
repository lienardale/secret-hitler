import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";

// A fresh ticket key pair for every test run, so no key is ever committed.
// The private half is a test-only binding used by test/helpers to mint tickets.
const keys = await generateKeyPair("Ed25519", { extractable: true });

const TEST_BINDINGS = {
  ENVIRONMENT: "test",
  ALLOWED_ORIGINS: "http://localhost:3000",
  WEB_API_URL: "https://web.test",
  TICKET_PUBLIC_JWK: JSON.stringify(await exportJWK(keys.publicKey)),
  TEST_TICKET_PRIVATE_JWK: JSON.stringify(await exportJWK(keys.privateKey)),
  WEB_TO_ROOMS_SECRET: "ci-dummy-web-to-rooms-secret-0123456789",
  ROOMS_TO_WEB_SECRET: "ci-dummy-rooms-to-web-secret-0123456789",
};

// Tests run inside workerd (the Workers runtime) through Miniflare.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: TEST_BINDINGS },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // obscenity (word filters in @sh/protocol) ships CommonJS behind a thin
    // .mjs wrapper (`import mod from "./index.js"`). The pool transforms every
    // dependency as ESM, so that default import comes back undefined in
    // workerd. Pre-bundling it with esbuild turns it into real ESM; wrangler's
    // own bundle and Next already handle the interop.
    deps: { optimizer: { ssr: { enabled: true, include: ["obscenity"] } } },
  },
});
