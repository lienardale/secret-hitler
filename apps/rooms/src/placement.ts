/**
 * Where new Durable Objects are created: Western Europe, near the players and
 * the website (Vercel cdg1). A hint, applied only when an object is first
 * created; Cloudflare does not guarantee it (an EU jurisdiction would).
 * Every `getByName` passes it (docs/plan.md § Rooms Worker).
 */
export const PLACEMENT = {
  locationHint: "weur",
} as const satisfies DurableObjectNamespaceGetDurableObjectOptions;
