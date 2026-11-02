/**
 * Stores a report delivered by a room's outbox (POST /api/internal/reports).
 *
 * The room builds the report itself (the website only asked for it with
 * `reportToRoom`): who reported whom, why, and the evidence (members, the
 * latest chat messages, the game's public events). This is the only place
 * chat ever lands in Postgres.
 *
 * Delivery is at least once: the outbox retries for 3 days, and a delivery
 * that timed out may still be running when the next one arrives. So storing
 * is idempotent on `reportId` (= `Report.id`): one `INSERT … ON CONFLICT DO
 * NOTHING`, so a repeated or concurrent delivery inserts nothing, changes
 * nothing and answers `duplicate: true` (and no unique-violation error is
 * thrown or logged on the way).
 *
 * Parties: an account (`kind: "user"`) is linked by its id only while it
 * exists; a deleted or unknown account is stored with a null id. The names
 * the room showed are always kept (the record of what happened).
 *
 * Never log the payload: it holds chat.
 */
import type { ReportParty, ReportPayload } from "@sh/protocol";

import { isUuid } from "@/lib/games/ids";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

/** `Report.reporterName` / `targetName` are VARCHAR(40), `details` VARCHAR(500). */
const NAME_MAX = 40;
const DETAILS_MAX = 500;

export interface ReportIngestResult {
  /** The report was already stored (a repeated or concurrent delivery). */
  duplicate: boolean;
}

/** The payload passed the schema but cannot be stored: answer 400, never retry. */
export class InvalidReportError extends Error {
  override name = "InvalidReportError";
}

export type ReportIngestDb = Pick<PrismaClient, "report" | "user">;

/** First `max` characters (code points, as Postgres counts them). */
function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/** The account ids among the parties that still exist. */
async function liveAccounts(
  db: ReportIngestDb,
  parties: readonly ReportParty[],
): Promise<Set<string>> {
  const ids = [
    ...new Set(parties.flatMap((p) => (p.kind === "user" && isUuid(p.sub) ? [p.sub] : []))),
  ];
  if (ids.length === 0) return new Set();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(users.map((u) => u.id));
}

function accountId(party: ReportParty, live: ReadonlySet<string>): string | null {
  return party.kind === "user" && live.has(party.sub) ? party.sub : null;
}

/** The `Report` row for a checked payload. */
export function reportCreateInput(
  payload: ReportPayload,
  live: ReadonlySet<string>,
): Prisma.ReportCreateManyInput {
  return {
    id: payload.reportId,
    room: payload.room,
    reporterId: accountId(payload.reporter, live),
    reporterName: truncate(payload.reporter.name, NAME_MAX),
    targetId: accountId(payload.target, live),
    targetName: truncate(payload.target.name, NAME_MAX),
    reason: payload.reason,
    details: truncate(payload.details, DETAILS_MAX),
    evidence: payload.evidence as unknown as Prisma.InputJsonObject,
    createdAt: new Date(payload.createdAt),
  };
}

/**
 * Stores the report unless it is already stored. Throws `InvalidReportError`
 * for a payload that can never be stored, and lets database errors through
 * (the route answers 500 and the outbox retries).
 */
export async function ingestReport(
  db: ReportIngestDb,
  payload: ReportPayload,
): Promise<ReportIngestResult> {
  if (Number.isNaN(new Date(payload.createdAt).getTime())) {
    throw new InvalidReportError("createdAt out of range");
  }
  const live = await liveAccounts(db, [payload.reporter, payload.target]);
  const { count } = await db.report.createMany({
    data: [reportCreateInput(payload, live)],
    skipDuplicates: true,
  });
  return { duplicate: count === 0 };
}
