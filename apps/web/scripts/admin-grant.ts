/**
 * `npm -w @sh/web run admin:grant -- <email> [--role MODERATOR|ADMIN|USER]`
 *
 * Bootstraps the first admin (or changes an account's role) on the database
 * in POSTGRES_URL_NON_POOLING / POSTGRES_URL (apps/web/.env.local locally; for
 * staging, export the URL from the Neon dashboard in the shell first).
 * The account must exist. Prints the account's id and new role, never the URL.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const ROLES = ["USER", "MODERATOR", "ADMIN"] as const;
type Role = (typeof ROLES)[number];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args.find((arg) => !arg.startsWith("--"));
  const roleIndex = args.indexOf("--role");
  const role = (roleIndex >= 0 ? args[roleIndex + 1] : "ADMIN") as Role;
  if (!email || !ROLES.includes(role)) {
    console.error("usage: admin:grant -- <email> [--role MODERATOR|ADMIN|USER]");
    process.exit(2);
  }
  const { prisma, disconnectPrisma } = await import("../lib/db/prisma");
  try {
    // Looked up first: an update of a missing row would make our Prisma listener log a P2025.
    const found = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!found) {
      console.error("no account with this e-mail address");
      process.exitCode = 1;
      return;
    }
    const user = await prisma.user.update({
      where: { id: found.id },
      data: { role },
      select: { id: true, role: true },
    });
    console.log(`account ${user.id} is now ${user.role}`);
  } finally {
    await disconnectPrisma();
  }
}

// No top-level await: apps/web is not an ES module package, so tsx compiles this as CommonJS.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "admin:grant failed");
  process.exitCode = 1;
});
