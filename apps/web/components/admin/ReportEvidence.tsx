/**
 * A report's evidence as the room captured it: the chat transcript, who was
 * in the room, and the public game log. No state and no "use client": the
 * report page renders them on the server, and the jsdom tests render them
 * under NextIntlClientProvider.
 *
 * Nothing is told by colour alone: the reported player's and the reporter's
 * lines carry a word tag, system messages are introduced for screen readers.
 */
import type { Seat } from "@sh/engine";
import type { ChatMessage } from "@sh/protocol";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { describeEvent, type LogLine } from "@/components/game/log-text";
import type { SeatNames } from "@/components/game/names";
import type { GameT } from "@/components/game/status";
import { PROFILE_TIME_ZONE } from "@/components/profile/format";
import type { EvidenceView } from "@/lib/moderation/admin";

import { AdminSection, Tag } from "./Section";

export type EvidenceMember = EvidenceView["members"][number];

/** A party of the report, as the page knows it. */
export interface PartyRef {
  /** Account id (null once deleted). */
  id: string | null;
  nameAtReport: string;
}

/**
 * The room id (pid) of a report party: the account member whose `sub` is the
 * account id, else (deleted account) the member with the name it had.
 */
export function partyPid(members: readonly EvidenceMember[], party: PartyRef): string | null {
  const id = party.id?.toLowerCase();
  const byAccount = id
    ? members.find((member) => member.kind === "user" && member.sub.toLowerCase() === id)
    : undefined;
  if (byAccount) return byAccount.pid;
  return members.find((member) => member.name === party.nameAtReport)?.pid ?? null;
}

const TIME = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: PROFILE_TIME_ZONE,
} as const;

function validDate(at: number): Date | null {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function Time({ at }: { at: number }) {
  const format = useFormatter();
  const date = validDate(at);
  if (!date) return null;
  return (
    <time dateTime={date.toISOString()} className="mr-2 text-xs text-ink-muted tabular-nums">
      {format.dateTime(date, TIME)}
    </time>
  );
}

function TranscriptLine({
  message,
  targetPid,
  reporterPid,
}: {
  message: ChatMessage;
  targetPid: string | null;
  reporterPid: string | null;
}) {
  const t = useTranslations("admin");
  const tRoom = useTranslations("room");
  if (message.kind === "system") {
    return (
      <li data-testid="transcript-line" data-kind="system" className="pl-3 text-sm italic">
        <Time at={message.at} />
        <span className="sr-only">{t("evidence.system")} </span>
        <span className="text-ink-muted">
          {tRoom(`chat.system.${message.key}`, message.params as Record<string, string>)}
        </span>
      </li>
    );
  }
  const isTarget = targetPid !== null && message.pid === targetPid;
  const isReporter = !isTarget && reporterPid !== null && message.pid === reporterPid;
  return (
    <li
      data-testid="transcript-line"
      data-kind="player"
      data-target={isTarget ? "true" : undefined}
      className={`border-l-4 py-0.5 pl-2 break-words ${isTarget ? "border-fascist bg-paper" : "border-transparent"}`}
    >
      <Time at={message.at} />
      <span className="font-semibold">{message.name}</span>{" "}
      {isTarget && <Tag tone="target">{t("evidence.targetTag")}</Tag>}
      {isReporter && <Tag tone="reporter">{t("evidence.reporterTag")}</Tag>}
      {(isTarget || isReporter) && " "}
      <span className={isTarget ? "font-medium" : undefined}>{message.text}</span>
    </li>
  );
}

/** The chat, oldest first, with the reported player's lines marked. */
export function Transcript({
  headingId,
  chat,
  targetPid,
  reporterPid,
}: {
  headingId: string;
  chat: readonly ChatMessage[];
  targetPid: string | null;
  reporterPid: string | null;
}) {
  const t = useTranslations("admin");
  return (
    <AdminSection
      id={headingId}
      title={t("evidence.transcript")}
      lead={t("evidence.transcriptLead")}
    >
      {chat.length === 0 ? (
        <p>{t("evidence.transcriptEmpty")}</p>
      ) : (
        <ol className="space-y-1" aria-labelledby={headingId} data-testid="transcript">
          {chat.map((message, index) => (
            <TranscriptLine
              key={`${message.id}-${index}`}
              message={message}
              targetPid={targetPid}
              reporterPid={reporterPid}
            />
          ))}
        </ol>
      )}
    </AdminSection>
  );
}

/** Everyone in the room when the report was made: seat, host, connection, account or guest. */
export function MembersList({
  headingId,
  members,
  targetPid,
  reporterPid,
}: {
  headingId: string;
  members: readonly EvidenceMember[];
  targetPid: string | null;
  reporterPid: string | null;
}) {
  const t = useTranslations("admin");
  return (
    <AdminSection id={headingId} title={t("evidence.members")}>
      {members.length === 0 ? (
        <p>{t("evidence.membersEmpty")}</p>
      ) : (
        <ul className="divide-y divide-rule" aria-labelledby={headingId} data-testid="members">
          {members.map((member) => {
            const facts = [
              member.seat === null
                ? t("evidence.noSeat")
                : t("evidence.seat", { n: member.seat + 1 }),
              ...(member.host ? [t("evidence.host")] : []),
              member.connected ? t("evidence.connected") : t("evidence.disconnected"),
              member.kind === "user" ? t("evidence.account") : t("evidence.guest"),
            ];
            return (
              <li key={member.pid} className="space-y-0.5 py-2" data-testid="member">
                <p className="space-x-1">
                  <span className="font-semibold break-words">{member.name}</span>
                  {member.pid === targetPid && <Tag tone="target">{t("evidence.targetTag")}</Tag>}
                  {member.pid === reporterPid && (
                    <Tag tone="reporter">{t("evidence.reporterTag")}</Tag>
                  )}
                </p>
                <p className="text-sm text-ink-muted">{facts.join(" · ")}</p>
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}

/** Seat names from the members list (no "(you)": the moderator was not playing). */
function seatNames(members: readonly EvidenceMember[], t: GameT, locale: string): SeatNames {
  const bySeat = new Map<Seat, string>();
  for (const member of members) if (member.seat !== null) bySeat.set(member.seat, member.name);
  const plain = (seat: Seat) => bySeat.get(seat) ?? t("seat.fallback", { n: seat + 1 });
  const format = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  return { plain, name: plain, list: (seats) => format.format(seats.map(plain)) };
}

const TONE: Record<NonNullable<LogLine["tone"]>, string> = {
  liberal: "border-liberal",
  fascist: "border-fascist",
  danger: "border-fascist",
};

/** The current game's public events, as sentences (components/game/log-text.ts). */
export function PublicGameLog({
  headingId,
  events,
  members,
  game,
}: {
  headingId: string;
  events: EvidenceView["events"];
  members: readonly EvidenceMember[];
  game: EvidenceView["game"];
}) {
  const t = useTranslations("admin");
  const tGame = useTranslations("game");
  const locale = useLocale();
  const names = seatNames(members, tGame, locale);
  const lines = events.flatMap((event, index) => {
    const line = describeEvent(event, names, tGame);
    return line ? [{ ...line, index }] : [];
  });
  return (
    <AdminSection
      id={headingId}
      title={t("evidence.gameLog")}
      lead={
        game
          ? `${t("evidence.gameNumber", { number: game.number })} · ${t("evidence.gameLogLead")}`
          : t("evidence.gameLogLead")
      }
    >
      {lines.length === 0 ? (
        <p>{t("evidence.gameLogEmpty")}</p>
      ) : (
        <ol className="space-y-1 text-sm" aria-labelledby={headingId} data-testid="game-log">
          {lines.map((line) =>
            line.round ? (
              <li
                key={line.index}
                className="pt-2 font-display text-sm tracking-wide text-ink-muted uppercase first:pt-0"
              >
                {line.text}
              </li>
            ) : (
              <li
                key={line.index}
                className={`border-l-2 pl-2 leading-snug ${line.tone ? TONE[line.tone] : "border-transparent"}`}
              >
                {line.text}
                {line.detail && <span className="block text-xs text-ink-muted">{line.detail}</span>}
              </li>
            ),
          )}
        </ol>
      )}
    </AdminSection>
  );
}
