/**
 * Daily retention cleanup (lib/retention/cleanup.ts), called by Vercel Cron
 * (apps/web/vercel.json) with `Authorization: Bearer <CRON_SECRET>`. Answers
 * 404 when CRON_SECRET is not set (local dev, tests), 401 to anyone else.
 */
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { runRetentionCleanup } from "@/lib/retention/cleanup";
import { authorized } from "@/lib/retention/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const counts = await runRetentionCleanup(prisma);
  // Counts only: no personal data in the log.
  console.info(`[retention] ${JSON.stringify(counts)}`);
  return Response.json({ ok: true, ...counts });
}
