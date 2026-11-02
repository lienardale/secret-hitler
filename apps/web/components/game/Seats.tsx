"use client";

import type { PlayerView, Role, Seat, SeatView } from "@sh/engine";
import type { PlayerSlot } from "@sh/protocol";
import { useTranslations } from "next-intl";
import { useId } from "react";

import {
  AutoIcon,
  CheckIcon,
  HourglassIcon,
  InvestigateIcon,
  LockIcon,
  OfflineIcon,
  RoleEmblem,
  ShieldIcon,
  TombIcon,
} from "./art";
import { InitialsBadge } from "./InitialsBadge";
import { BALLOT_STEP_MS, ballotOrder, useFreshDeaths } from "./motion";
import type { SeatNames } from "./names";
import { waitingSeats } from "./status";

/** Width/height ratio used to space seats evenly around the table on wide screens. */
const TABLE_ASPECT = 1.45;

/**
 * Where seat `k` sits on wide screens, in % of the table box: seats are spread
 * evenly along a rectangle, clockwise, starting at the bottom centre (where
 * the viewer sits). Clockwise on screen = increasing seat number, as at a real
 * table.
 */
export function seatPosition(k: number, n: number): { x: number; y: number } {
  const w = TABLE_ASPECT;
  const h = 1;
  let d = (k / n) * 2 * (w + h);
  let u: number;
  let v: number;
  if (d < w / 2) {
    u = 0.5 - d / w;
    v = 1;
  } else if ((d -= w / 2) < h) {
    u = 0;
    v = 1 - d / h;
  } else if ((d -= h) < w) {
    u = d / w;
    v = 0;
  } else if ((d -= w) < h) {
    u = 1;
    v = d / h;
  } else {
    d -= h;
    u = 1 - d / w;
    v = 1;
  }
  return { x: 9 + 82 * u, y: 8 + 85 * v };
}

/**
 * The players around the table. Phones: a compact grid under the board.
 * From 768 px: seats around a table with the board in the middle. Every seat
 * the game waits for is marked, in every phase. A fresh vote result shows the
 * ballots one by one from the President (at once under reduced motion).
 */
export function Seats({
  view,
  players,
  names,
  initials,
  freshVote = false,
  center,
}: {
  view: PlayerView;
  players: readonly PlayerSlot[];
  names: SeatNames;
  /** Initials per seat (index = seat). */
  initials: readonly string[];
  /** The last vote just came in: stage its ballots. */
  freshVote?: boolean;
  /** Drawn in the middle of the table (the board). */
  center: React.ReactNode;
}) {
  const t = useTranslations("game");
  const headingId = useId();
  const n = view.seats.length;
  const anchor = view.me?.seat ?? 0;
  const waiting = new Set<Seat>(waitingSeats(view));
  const executed = useFreshDeaths(view);
  const order =
    freshVote && view.lastVote ? ballotOrder(view.lastVote.votes, view.lastVote.president) : null;
  return (
    <section aria-labelledby={headingId} className="relative md:mx-auto md:h-[44rem] md:max-w-4xl">
      <h2 id={headingId} className="sr-only">
        {t("table.seats")}
      </h2>
      <div
        aria-hidden
        className="sh-felt hidden md:absolute md:inset-x-[4.5rem] md:inset-y-[3.5rem] md:block md:rounded-[3rem] md:border-2 md:border-rule"
      />
      <div className="md:absolute md:inset-x-[9.5rem] md:inset-y-[7rem] md:flex md:items-center md:justify-center">
        {center}
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 min-[520px]:grid-cols-3 md:mt-0 md:block">
        {view.seats.map((seat) => {
          const pos = seatPosition((seat.seat - anchor + n) % n, n);
          return (
            <li
              key={seat.seat}
              style={{ "--sx": `${pos.x}%`, "--sy": `${pos.y}%` } as React.CSSProperties}
              className="min-w-0 md:absolute md:top-(--sy) md:left-(--sx) md:w-[8.25rem] md:-translate-x-1/2 md:-translate-y-1/2"
            >
              <SeatCard
                seat={seat}
                view={view}
                player={players[seat.seat]}
                name={names.plain(seat.seat)}
                initials={initials[seat.seat] ?? ""}
                isMe={view.me?.seat === seat.seat}
                waiting={waiting.has(seat.seat)}
                executed={executed.includes(seat.seat)}
                ballotRank={order?.[seat.seat] ?? null}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const ROLE_CHIP: Record<Role, string> = {
  liberal: "border-liberal bg-liberal text-paper",
  fascist: "border-fascist bg-fascist text-paper",
  hitler: "border-fascist bg-paper-raised text-fascist",
};

function Badge({
  icon,
  children,
  title,
  tone = "border-rule text-ink-muted",
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
  tone?: string;
}) {
  return (
    <li
      title={title}
      className={`inline-flex max-w-full items-center gap-0.5 rounded-sm border px-1 py-px text-[0.65rem] leading-tight ${tone}`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </li>
  );
}

function SeatCard({
  seat,
  view,
  player,
  name,
  initials,
  isMe,
  waiting,
  executed,
  ballotRank,
}: {
  seat: SeatView;
  view: PlayerView;
  player: PlayerSlot | undefined;
  name: string;
  initials: string;
  isMe: boolean;
  /** The game waits for this seat (any phase). */
  waiting: boolean;
  /** Executed since the previous render. */
  executed: boolean;
  /** Position in the staged ballot reveal, or null to show the ballot at once. */
  ballotRank: number | null;
}) {
  const t = useTranslations("game");
  const icon = "size-3 shrink-0";
  const ballot = view.phase.kind !== "vote" ? (view.lastVote?.votes[seat.seat] ?? null) : null;
  const role = view.roles?.[seat.seat] ?? null;
  const office = seat.isPresident
    ? t("seat.president")
    : seat.isChancellor
      ? t("seat.chancellor")
      : seat.isNominee
        ? t("seat.nominee")
        : null;

  return (
    <div
      data-testid="seat"
      data-seat={seat.seat}
      {...(isMe ? { "data-you": "true" } : {})}
      {...(waiting ? { "data-waiting": "true" } : {})}
      className={`sh-seat relative flex h-full flex-col gap-1 rounded-lg border-2 bg-paper-raised p-2 shadow-sm ${
        isMe ? "border-ink ring-2 ring-ink/20" : "border-rule"
      } ${seat.alive ? "" : "sh-dead"} ${executed ? "sh-executed" : ""}`}
    >
      {office ? (
        <p
          className={`-mx-2 -mt-2 mb-0.5 rounded-t-md px-2 py-0.5 text-center font-display text-[0.7rem] tracking-widest uppercase ${
            seat.isNominee
              ? "border-b-2 border-dashed border-ink bg-paper text-ink"
              : "bg-ink text-paper"
          }`}
        >
          {office}
        </p>
      ) : null}
      <p className="flex min-w-0 items-center gap-1.5">
        <InitialsBadge initials={initials} className="text-ink-muted" />
        <span
          className={`truncate font-display text-lg leading-tight ${seat.alive ? "" : "line-through decoration-2"}`}
        >
          {name}
        </span>
      </p>
      <ul className="flex flex-wrap gap-1">
        {isMe ? (
          <Badge tone="border-ink bg-ink font-medium tracking-wide text-paper uppercase">
            {t("seat.you")}
          </Badge>
        ) : null}
        {role ? (
          <Badge icon={<RoleEmblem role={role} className={icon} />} tone={ROLE_CHIP[role]}>
            {t(`role.${role}`)}
          </Badge>
        ) : null}
        {!seat.alive ? (
          <Badge icon={<TombIcon className={icon} />} tone="border-ink text-ink">
            {t("seat.dead")}
          </Badge>
        ) : null}
        {seat.hasVoted === true ? (
          <Badge icon={<CheckIcon className={icon} />} tone="border-ink text-ink">
            {t("seat.voted")}
          </Badge>
        ) : null}
        {waiting && view.phase.kind === "vote" ? (
          <Badge icon={<HourglassIcon className={icon} />}>{t("seat.notVoted")}</Badge>
        ) : null}
        {waiting && view.phase.kind !== "vote" ? (
          <Badge icon={<HourglassIcon className={icon} />} tone="border-ink bg-ink text-paper">
            {isMe ? t("seat.yourTurn") : t("seat.theirTurn")}
          </Badge>
        ) : null}
        {ballot !== null ? (
          <li
            style={
              ballotRank === null
                ? undefined
                : ({ "--sh-delay": `${ballotRank * BALLOT_STEP_MS}ms` } as React.CSSProperties)
            }
            className={`sh-ballot-chip inline-flex items-center rounded-sm border-2 px-1.5 font-display text-xs leading-tight ${
              ballot ? "border-ink bg-paper text-ink" : "border-ink bg-ink text-paper"
            } ${ballotRank === null ? "" : "sh-ballot-reveal"}`}
          >
            <span className="sr-only">{t("seat.ballot", { vote: ballot ? "ja" : "nein" })}</span>
            <span aria-hidden>{ballot ? t("action.vote.ja") : t("action.vote.nein")}</span>
          </li>
        ) : null}
        {seat.termLimited && seat.alive ? (
          <Badge icon={<LockIcon className={icon} />} title={t("seat.termLimitedHint")}>
            {t("seat.termLimited")}
          </Badge>
        ) : null}
        {seat.confirmedNotHitler ? (
          <Badge
            icon={<ShieldIcon className={icon} />}
            title={t("seat.notHitlerHint")}
            tone="border-liberal text-liberal"
          >
            {t("seat.notHitler")}
          </Badge>
        ) : null}
        {seat.investigated ? (
          <Badge icon={<InvestigateIcon className={icon} />}>{t("seat.investigated")}</Badge>
        ) : null}
        {player && !player.connected ? (
          <Badge icon={<OfflineIcon className={icon} />} tone="border-fascist text-fascist">
            {t("seat.offline")}
          </Badge>
        ) : null}
        {player?.afk ? (
          <Badge icon={<AutoIcon className={icon} />} tone="border-fascist text-fascist">
            {t("seat.afk")}
          </Badge>
        ) : null}
      </ul>
    </div>
  );
}
