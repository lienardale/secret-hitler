/**
 * Prisma 7 CLI configuration (from velo-atelier).
 *
 * The datasource URL no longer lives in schema.prisma and the CLI no longer
 * loads `.env` itself, so this file gives `migrate`, `db seed` and friends both.
 *
 * - The direct (unpooled) URL: DDL and the migration lock do not survive a
 *   transaction pooler (Neon's pooled endpoint).
 * - `?? ""` rather than a throw: `prisma generate` runs on install (CI, Vercel)
 *   where there is no database; only the commands that need one fail.
 */
import { config as loadEnvFiles } from "dotenv";

loadEnvFiles({ path: [".env.local", ".env"], quiet: true });

import { defineConfig } from "prisma/config";

import { readDatabaseUrls } from "./lib/db/env";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: readDatabaseUrls().direct ?? "",
  },
});
