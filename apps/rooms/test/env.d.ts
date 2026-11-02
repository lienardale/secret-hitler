// Test-only binding set in vitest.config.ts: the private half of the test ticket key.
declare namespace Cloudflare {
  interface Env {
    TEST_TICKET_PRIVATE_JWK: string;
  }
}
