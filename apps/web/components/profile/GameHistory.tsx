/**
 * The profile's game history: one entry per game, newest first (the page
 * fetches and pages them). Renders on the server; only the "Block" buttons
 * are client components.
 *
 * Others' account ids (`userId`) reach the HTML only inside those buttons,
 * and this page is shown to its owner only (lib/games/history.ts).
 */
import { useFormatter, useTranslations } from "next-intl";

import type { HistoryGame, Role } from "@/lib/games/history";

import { DATE_TIME } from "./format";
import { BlockPlayerButton } from "./ProfileForms";

const REASONS = ["liberalPolicies", "hitlerExecuted", "fascistPolicies", "hitlerElected"] as const;
type Reason = (typeof REASONS)[number];

function isReason(value: string | null): value is Reason {
  return value !== null && (REASONS as readonly string[]).includes(value);
}

function roleClass(role: Role): string {
  return role === "liberal" ? "text-liberal" : "text-fascist";
}

export function GameHistory({
  games,
  meId,
  blockedIds,
}: {
  games: readonly HistoryGame[];
  meId: string;
  blockedIds: ReadonlySet<string>;
}) {
  const t = useTranslations("profile");
  if (games.length === 0) {
    return <p className="text-ink-muted">{t("history.empty")}</p>;
  }
  return (
    <ol className="space-y-4" data-testid="history-list">
      {games.map((game) => (
        <HistoryEntry key={game.id} game={game} meId={meId} blockedIds={blockedIds} />
      ))}
    </ol>
  );
}

function HistoryEntry({
  game,
  meId,
  blockedIds,
}: {
  game: HistoryGame;
  meId: string;
  blockedIds: ReadonlySet<string>;
}) {
  const t = useTranslations("profile");
  const format = useFormatter();
  const winner = game.outcome === "finished" ? game.winner : null;
  const finished = winner !== null;
  const result = winner !== null ? t("history.finished", { team: winner }) : t("history.abandoned");
  const verdict = !finished
    ? t("history.noResult")
    : game.you.won
      ? t("history.won")
      : t("history.lost");

  return (
    <li
      data-testid="history-game"
      data-game-id={game.id}
      className="space-y-3 rounded-md border-2 border-rule bg-paper p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-2xl">
          {result}
          {finished && isReason(game.reason) && (
            <span className="font-body text-base text-ink-muted">
              {" "}
              · {t(`history.reason.${game.reason}`)}
            </span>
          )}
        </h3>
        <time dateTime={game.endedAt.toISOString()} className="text-sm text-ink-muted">
          {format.dateTime(game.endedAt, DATE_TIME)}
        </time>
      </div>

      <p className="text-sm text-ink-muted">
        {game.visibility === "public" ? t("history.public") : t("history.private")} ·{" "}
        {t("history.room", { room: game.room })}
        {game.number > 1 && <> · {t("history.number", { number: game.number })}</>}
      </p>

      <p className="flex flex-wrap items-baseline gap-x-3">
        <span>
          {t.rich("history.you", {
            role: t(`roles.${game.you.role}`),
            strong: (chunks) => <strong className={roleClass(game.you.role)}>{chunks}</strong>,
          })}
          {!game.you.alive && <span className="text-ink-muted"> ({t("history.executed")})</span>}
        </span>
        <strong className="rounded border-2 border-ink px-2 text-sm uppercase tracking-wide">
          {verdict}
        </strong>
      </p>
      {game.you.left && <p className="text-sm">{t("history.left")}</p>}

      <div>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2" aria-label={t("history.players")}>
          {game.others.map((player) => (
            <li key={player.seat} className="flex min-h-9 items-center justify-between gap-2">
              <span className="min-w-0">
                {player.name === null ? (
                  <span className="italic text-ink-muted">
                    {t(player.guest ? "history.unnamedGuest" : "history.deletedPlayer")}
                  </span>
                ) : (
                  <span className="break-words">{player.name}</span>
                )}
                {player.userId === null && player.name !== null && (
                  <span className="text-sm text-ink-muted"> ({t("history.guest")})</span>
                )}
                <span className="text-sm">
                  {" · "}
                  <span className={roleClass(player.role)}>{t(`roles.${player.role}`)}</span>
                </span>
              </span>
              {player.userId !== null && player.userId !== meId && player.name !== null && (
                <BlockPlayerButton
                  userId={player.userId}
                  name={player.name}
                  blocked={blockedIds.has(player.userId)}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
