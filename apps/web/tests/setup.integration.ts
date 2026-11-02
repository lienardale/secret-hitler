/**
 * Integration tier, before every file: point Prisma at the `_test` database
 * (refusing anything else), empty it, and close the pool afterwards so the
 * fork exits. Migrations run once per run (tests/integration/global-setup.ts).
 */
import { afterAll, beforeAll } from "vitest";

import { emptyTestDatabase, applyTestDatabaseEnv } from "./_db/test-db";

const { direct } = applyTestDatabaseEnv();

beforeAll(async () => {
  await emptyTestDatabase(direct);
});

afterAll(async () => {
  const { disconnectPrisma } = await import("@/lib/db/prisma");
  await disconnectPrisma();
});
