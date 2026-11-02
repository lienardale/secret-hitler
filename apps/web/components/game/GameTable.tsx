"use client";

import type { Action, GameEvent, PlayerView } from "@sh/engine";
import type { PlayerSlot } from "@sh/protocol";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { ActionPanel } from "./ActionPanel";
import { Board } from "./Board";
import { EventLog } from "./EventLog";
import { GameOver } from "./GameOver";
import { assignInitials } from "./initials";
import { InvestigationPanel } from "./InvestigationPanel";
import { useFreshVoteResult } from "./motion";
import { useSeatNames } from "./names";
import { PhaseBanner } from "./PhaseBanner";
import { RoleCard } from "./RoleCard";
import { Seats } from "./Seats";

export interface GameTableProps {
  /** This player's projection (a spectator's when `view.me` is null). */
  view: PlayerView;
  /** Events this viewer may see, oldest first. */
  log: GameEvent[];
  /** Index = seat number. */
  players: PlayerSlot[];
  /** Current decision id (only used to know when a new decision starts). */
  turn: number;
  /** When the current decision times out (ms since epoch, server clock), or null. */
  deadline: number | null;
  /** serverTime - Date.now(). */
  clockOffset: number;
  onAction: (action: Action) => void;
  /** An action of this player is in flight: controls are disabled. */
  pending?: boolean;
  /** Side content (the chat): a side column on wide screens, below the table on phones. */
  aside?: React.ReactNode;
}

/**
 * The whole game table, driven only by the viewer's `PlayerView`: phase banner
 * and timer, action panel, role card, board, seats, event log, game over.
 */
export function GameTable({
  view,
  log,
  players,
  turn,
  deadline,
  clockOffset,
  onAction,
  pending = false,
  aside,
}: GameTableProps) {
  const t = useTranslations("game");
  const me = view.me;
  const names = useSeatNames(players, me?.seat ?? null);
  const seatCount = view.seats.length;
  const initials = useMemo(
    () => assignInitials(Array.from({ length: seatCount }, (_, seat) => names.plain(seat))),
    [names, seatCount],
  );
  const freshVote = useFreshVoteResult(view);
  const phase = view.phase;
  const over = phase.kind === "over";
  // The room stopped the game without a winner: the view reveals every role (engine `stopped`).
  const stopped = !over && view.roles !== null;
  const ended = over || stopped;

  return (
    <section
      aria-label={t("table.label")}
      data-testid="game-table"
      data-phase={phase.kind}
      {...(phase.kind === "executive" ? { "data-power": phase.power } : {})}
      className="sh-table mx-auto w-full max-w-7xl"
    >
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <div className="min-w-0 space-y-4">
          {stopped ? null : (
            <PhaseBanner
              view={view}
              names={names}
              deadline={deadline}
              clockOffset={clockOffset}
              freshVote={freshVote}
            />
          )}
          {ended ? <GameOver view={view} names={names} /> : null}
          {me && !ended ? (
            <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 space-y-4">
                <InvestigationPanel log={log} seat={me.seat} names={names} />
                <ActionPanel
                  view={view}
                  me={me}
                  names={names}
                  initials={initials}
                  turn={turn}
                  onAction={onAction}
                  pending={pending}
                />
              </div>
              <RoleCard me={me} names={names} playerCount={view.playerCount} />
            </div>
          ) : null}
          <Seats
            view={view}
            players={players}
            names={names}
            initials={initials}
            freshVote={freshVote}
            center={<Board view={view} />}
          />
        </div>
        <div className="mt-4 min-w-0 space-y-4 xl:sticky xl:top-4 xl:mt-0">
          <EventLog log={log} names={names} />
          {aside ? <aside aria-label={t("table.aside")}>{aside}</aside> : null}
        </div>
      </div>
    </section>
  );
}
