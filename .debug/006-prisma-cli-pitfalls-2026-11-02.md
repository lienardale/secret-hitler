# 006 — Prisma 7 CLI pitfalls met while creating the first migration

## The update banner ends up in the SQL

**Observed.** `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script >
migration.sql 2>&1` produced a migration that failed with `syntax error at or near "┌───…"`.

**Cause.** Prisma prints an "Update available 7.10.1 -> 8.0.0-rc…" box on stderr; `2>&1` sent it
into the file. The failed migration was recorded as failed in `_prisma_migrations` of both
databases (nothing else was applied: Postgres ran it in a transaction).

**Fix.** Never merge stderr into a generated SQL file, and set `PRISMA_HIDE_UPDATE_MESSAGE=1`
(the CI scripts and test helpers do). To recover a migration that failed with no effect:
`npx prisma migrate resolve --rolled-back <name>` (non-destructive), then `migrate deploy`.

## `migrate reset` refuses AI agents

Prisma 7.10 refuses `migrate reset` when it detects an agent (`CLAUDECODE`, `CURSOR_AGENT`…)
unless the user's verbatim consent is passed. The test tiers therefore use `migrate deploy` +
`TRUNCATE` (`apps/web/tests/_db/test-db.ts`), which reach the same state without dropping
anything, and only after checking the URL is a local `*_test` database.
