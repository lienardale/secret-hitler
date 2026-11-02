/** `npm -w @sh/web run db:migrate:test`: applies the migrations to the `_test` database. */
import { migrateTestDatabase, applyTestDatabaseEnv } from "./test-db";

const { direct } = applyTestDatabaseEnv();
migrateTestDatabase(direct);
console.log("test database migrated");
