/**
 * The Prisma client singleton (from velo-atelier).
 *
 * - Driver adapter `@prisma/adapter-pg`: works on Vercel's Node runtime and
 *   through Neon's pooler. `max: 3` keeps a serverless instance from opening
 *   connections it will never reuse.
 * - Cached on `globalThis` so dev hot reloads do not leak pools.
 * - Errors are EVENTS, not stdout: the listener prints them through
 *   `reportPrismaError`, which drops exactly one expected line (the rate
 *   limiter's conditional-update miss, see lib/db/log.ts). Do not add the
 *   `"error"` shorthand or `{ emit: "stdout", level: "error" }` back: Prisma
 *   would print that miss itself again.
 * - Lazy: `next build` imports route modules, so the client (and the database
 *   URL) is only resolved on first use.
 *
 * Import path: `@/lib/db/prisma`. The generated client is only ever imported
 * as `@/lib/generated/prisma/client`.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { type Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import { getDatabaseUrls } from "./env";
import { reportPrismaError } from "./log";

const globalForPrisma = globalThis as typeof globalThis & {
  __shPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const { pooled } = getDatabaseUrls();
  const log: Prisma.LogDefinition[] = [{ emit: "event", level: "error" }];
  if (process.env.NODE_ENV === "development") log.push({ emit: "stdout", level: "warn" });

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: pooled, max: 3 }),
    log,
  });
  client.$on("error", (event) => reportPrismaError(event));
  return client;
}

function resolveClient(): PrismaClient {
  const existing = globalForPrisma.__shPrisma;
  if (existing) return existing;
  const client = createPrismaClient();
  globalForPrisma.__shPrisma = client;
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolveClient();
    const value = Reflect.get(client, property) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(resolveClient(), property);
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(resolveClient());
  },
});

/** Closes the pool (scripts and test teardown only). */
export async function disconnectPrisma(): Promise<void> {
  const client = globalForPrisma.__shPrisma;
  if (!client) return;
  globalForPrisma.__shPrisma = undefined;
  await client.$disconnect();
}
