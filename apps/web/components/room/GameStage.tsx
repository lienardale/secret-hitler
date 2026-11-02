"use client";

/**
 * The room during and after a game: the game table (components/game), the
 * chat beside it, everyone in the room with the player menu (mute, block,
 * report), and the host's controls (stop the game, play for a disconnected
 * player, rematch).
 */
import { useTranslations } from "next-intl";
import type { RoomView } from "@sh/protocol";

import { GameTable } from "@/components/game/GameTable";
import { KeepScreenOn } from "@/components/pwa/KeepScreenOn";
import { Button } from "@/components/ui/Button";
import { useRoomActions, useRoomState } from "@/lib/room-client/store";

import { ChatPanel } from "./ChatPanel";
import { RoomMembers } from "./RoomMembers";

function HostControls({ room }: { room: RoomView }) {
  const t = useTranslations("room");
  const { send } = useRoomActions();
  const view = useRoomState((s) => s.game?.view ?? null);
  if (room.visibility !== "private") return null;

  if (room.status === "ended") {
    return (
      <Button onClick={() => send({ t: "rematch" })} className="w-full sm:w-auto">
        {t("host.rematch")}
      </Button>
    );
  }
  const away = room.players.flatMap((slot, seat) =>
    !slot.connected && view?.seats[seat]?.alive ? [slot] : [],
  );
  return (
    <details className="rounded-lg border-2 border-rule bg-paper-raised px-4 py-3">
      <summary className="cursor-pointer font-display text-lg">{t("host.controls")}</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {away.map((slot) => (
          <Button
            key={slot.pid}
            variant="secondary"
            onClick={() => send({ t: "forceTurn", pid: slot.pid })}
          >
            {t("host.forceTurn", { name: slot.name })}
          </Button>
        ))}
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm(t("host.endGameConfirm"))) send({ t: "endGame" });
          }}
        >
          {t("host.endGame")}
        </Button>
      </div>
      {away.length > 0 && <p className="mt-2 text-sm text-ink-muted">{t("host.forceTurnHelp")}</p>}
    </details>
  );
}

export function GameStage({ room, youPid }: { room: RoomView; youPid: string }) {
  const t = useTranslations("room");
  const game = useRoomState((s) => s.game);
  const clockOffset = useRoomState((s) => s.clockOffset);
  const pending = useRoomState((s) => s.actionPending);
  const { act } = useRoomActions();
  const isHost = room.hostPid === youPid;

  if (!game) return null;
  return (
    <div className="space-y-4">
      {/* Phones dim and lock mid-game otherwise; released when the game ends or the tab hides. */}
      <KeepScreenOn active={room.status === "playing"} />
      {room.result?.kind === "abandoned" && (
        <p
          role="status"
          className="rounded-lg border-2 border-ink bg-paper-raised px-4 py-3 font-display text-xl"
        >
          {t("host.abandoned")}
        </p>
      )}
      <GameTable
        view={game.view}
        log={game.log}
        players={room.players}
        turn={game.turn}
        deadline={room.game?.deadline ?? null}
        clockOffset={clockOffset}
        onAction={act}
        pending={pending}
        aside={<ChatPanel className="h-[24rem] lg:h-[32rem]" />}
      />
      <RoomMembers room={room} youPid={youPid} />
      {isHost ? (
        <HostControls room={room} />
      ) : (
        room.status === "ended" &&
        room.visibility === "private" && (
          <p className="text-ink-muted">{t("host.rematchWaiting")}</p>
        )
      )}
    </div>
  );
}
