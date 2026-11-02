// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
// Declared on both Env interfaces generated in worker-configuration.d.ts.
interface Env {
  TICKET_PUBLIC_JWK: string;
  WEB_TO_ROOMS_SECRET: string;
  ROOMS_TO_WEB_SECRET: string;
}

declare namespace Cloudflare {
  interface Env {
    TICKET_PUBLIC_JWK: string;
    WEB_TO_ROOMS_SECRET: string;
    ROOMS_TO_WEB_SECRET: string;
  }
}
