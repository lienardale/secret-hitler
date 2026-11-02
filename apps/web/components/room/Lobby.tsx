"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { TIMER_PRESETS, type PlayerSlot, type RoomView, type TimerPreset } from "@sh/protocol";

import { useRemainingSeconds } from "@/components/game/clock";
import { Button } from "@/components/ui/Button";
import { useRoomActions, useRoomState } from "@/lib/room-client/store";

import { ChatPanel } from "./ChatPanel";
import { InviteBox } from "./InviteBox";
import { MutedTag, PlayerMenu } from "./PlayerMenu";

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

function SeatRow({
  slot,
  isYou,
  isHost,
  canKick,
}: {
  slot: PlayerSlot;
  isYou: boolean;
  isHost: boolean;
  canKick: boolean;
}) {
  const t = useTranslations("room");
  const { send } = useRoomActions();
  return (
    <li className="flex items-center gap-3 rounded-md border border-rule bg-paper py-1 pl-3 pr-1">
      <span
        aria-hidden
        className={`size-2.5 shrink-0 rounded-full ${slot.connected ? "bg-liberal" : "border border-ink-muted"}`}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{slot.name}</span>
        {isYou && <span className="text-ink-muted"> ({t("lobby.you")})</span>}
        {isHost && (
          <span className="ml-2 rounded-sm border border-ink px-1.5 text-xs uppercase tracking-wider">
            {t("lobby.host")}
          </span>
        )}
        {!slot.connected && (
          <span className="ml-2 text-sm text-ink-muted">{t("lobby.disconnected")}</span>
        )}
        <MutedTag pid={slot.pid} />
      </span>
      {canKick && (
        <Button
          variant="quiet"
          className="min-h-9 px-2 text-base"
          aria-label={t("lobby.kickLabel", { name: slot.name })}
          onClick={() => {
            if (window.confirm(t("lobby.kickConfirm", { name: slot.name })))
              send({ t: "kick", pid: slot.pid });
          }}
        >
          {t("lobby.kick")}
        </Button>
      )}
      {isYou ? <span className="h-11" aria-hidden /> : <PlayerMenu member={slot} />}
    </li>
  );
}

export function Lobby({ room, youPid }: { room: RoomView; youPid: string }) {
  const t = useTranslations("room");
  const id = useId();
  const { send } = useRoomActions();
  const isHost = room.hostPid === youPid;
  const seated = room.players.some((p) => p.pid === youPid);
  const count = room.players.length;
  const allConnected = room.players.every((p) => p.connected);
  const missing = Math.max(0, MIN_PLAYERS - count);
  const canStart = isHost && room.visibility === "private" && missing === 0 && allConnected;
  const isPublic = room.visibility === "public";
  const clockOffset = useRoomState((s) => s.clockOffset);
  const startsIn = useRemainingSeconds(isPublic ? room.startsAt : null, clockOffset);

  // Public rooms start on their own: a countdown once `minPlayers` are seated and connected.
  const publicHint =
    startsIn !== null
      ? t("lobby.publicStartsIn", { seconds: startsIn })
      : t("lobby.publicWaiting", {
          min: room.settings.minPlayers,
          missing: Math.max(0, room.settings.minPlayers - count),
        });
  const startHint = isPublic
    ? publicHint
    : missing > 0
      ? t("lobby.needPlayers", { missing })
      : !allConnected
        ? t("lobby.waitingDisconnected")
        : !isHost
          ? t("lobby.waitingHost")
          : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <InviteBox code={room.code} />

        <section
          aria-labelledby={`${id}-players`}
          className="rounded-lg border-2 border-rule bg-paper-raised p-4 sm:p-5"
        >
          <h2 id={`${id}-players`} className="font-display text-2xl">
            {t("lobby.players", { count })}
          </h2>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2">
            {room.players.map((slot) => (
              <SeatRow
                key={slot.pid}
                slot={slot}
                isYou={slot.pid === youPid}
                isHost={slot.pid === room.hostPid}
                canKick={isHost && slot.pid !== youPid}
              />
            ))}
            {Array.from({ length: MAX_PLAYERS - count }, (_, i) => (
              <li
                key={`empty-${i}`}
                aria-hidden={i > 0}
                className="rounded-md border border-dashed border-rule px-3 py-2 text-ink-muted"
              >
                {t("lobby.emptySeat")}
              </li>
            ))}
          </ol>

          {room.spectators.length > 0 && (
            <>
              <h3 className="mt-5 font-display text-xl">
                {t("lobby.spectators", { count: room.spectators.length })}
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {room.spectators.map((s) => (
                  <li
                    key={s.pid}
                    className="flex min-h-11 items-center rounded-full border border-rule pl-3 pr-1 text-sm"
                  >
                    <span className="py-1">
                      {s.name}
                      {s.pid === youPid && (
                        <span className="text-ink-muted"> ({t("lobby.you")})</span>
                      )}
                    </span>
                    <MutedTag pid={s.pid} />
                    {s.pid === youPid ? (
                      <span className="w-2" aria-hidden />
                    ) : (
                      <PlayerMenu member={s} />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {seated ? (
              <Button variant="secondary" onClick={() => send({ t: "stand" })}>
                {t("lobby.stand")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={count >= MAX_PLAYERS}
                onClick={() => send({ t: "sit" })}
              >
                {t("lobby.sit")}
              </Button>
            )}
            {isHost && room.visibility === "private" && (
              <Button
                disabled={!canStart}
                onClick={() => send({ t: "start" })}
                aria-describedby={startHint ? `${id}-hint` : undefined}
              >
                {t("lobby.start")}
              </Button>
            )}
          </div>
          {startHint && (
            <p
              id={`${id}-hint`}
              data-testid="start-hint"
              aria-live={isPublic ? "polite" : undefined}
              className={`mt-2 ${startsIn !== null ? "font-display text-xl text-ink" : "text-ink-muted"}`}
            >
              {startHint}
            </p>
          )}
        </section>

        {isHost && (
          <section
            aria-labelledby={`${id}-settings`}
            className="rounded-lg border-2 border-rule bg-paper-raised p-4 sm:p-5"
          >
            <h2 id={`${id}-settings`} className="font-display text-2xl">
              {t("lobby.settings")}
            </h2>
            <label htmlFor={`${id}-timers`} className="mt-3 block font-display text-lg">
              {t("lobby.timers")}
            </label>
            <select
              id={`${id}-timers`}
              value={room.settings.timers}
              onChange={(event) =>
                send({ t: "settings", timers: event.target.value as TimerPreset })
              }
              className="mt-1 rounded-md border-2 border-rule bg-paper px-3 py-2"
            >
              {TIMER_PRESETS.filter(
                (preset) => room.visibility === "private" || preset !== "off",
              ).map((preset) => (
                <option key={preset} value={preset}>
                  {t(`lobby.timer.${preset}`)}
                </option>
              ))}
            </select>
            <p className="mt-2 text-sm text-ink-muted">{t("lobby.timersHelp")}</p>
            {isPublic && (
              <>
                <label htmlFor={`${id}-min`} className="mt-4 block font-display text-lg">
                  {t("lobby.minPlayers")}
                </label>
                <select
                  id={`${id}-min`}
                  value={room.settings.minPlayers}
                  onChange={(event) =>
                    send({ t: "settings", minPlayers: Number(event.target.value) })
                  }
                  className="mt-1 rounded-md border-2 border-rule bg-paper px-3 py-2"
                >
                  {Array.from(
                    { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
                    (_, i) => MIN_PLAYERS + i,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-sm text-ink-muted">{t("lobby.minPlayersHelp")}</p>
              </>
            )}
          </section>
        )}
      </div>

      <ChatPanel className="h-[28rem] lg:h-auto lg:max-h-[calc(100dvh-8rem)]" />
    </div>
  );
}
