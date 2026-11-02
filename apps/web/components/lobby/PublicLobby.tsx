"use client";

/**
 * The live list of public rooms, from the Lobby Durable Object's WebSocket
 * (`/v1/lobby/ws`, pushed at most once a second). partysocket reconnects on
 * its own; a `ping` every 30 s keeps the socket open without waking the object.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import ReconnectingWebSocket from "partysocket/ws";
import { KEEPALIVE_PING, type LobbyEntry } from "@sh/protocol";

import { useRemainingSeconds } from "@/components/game/clock";
import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";
import { lobbySocketUrl, parseLobbyMessage } from "@/lib/lobby-client/parse";

type Status = "connecting" | "open" | "offline";

function RoomRow({ room, clockOffset }: { room: LobbyEntry; clockOffset: number }) {
  const t = useTranslations("lobby");
  const startsIn = useRemainingSeconds(room.status === "lobby" ? room.startsAt : null, clockOffset);
  const full = room.players >= room.maxPlayers;
  const joinable = room.status === "lobby" && !full;
  const state =
    room.status === "playing"
      ? t("room.playing")
      : startsIn !== null
        ? t("room.startsIn", { seconds: startsIn })
        : t("room.waiting");
  return (
    <li
      data-testid="lobby-room"
      data-code={room.code}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border-2 border-rule bg-paper px-4 py-3"
    >
      <span className="font-display text-2xl tracking-[0.2em]">{room.code}</span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">
          {t("room.players", { players: room.players, max: room.maxPlayers })}
        </span>
        {room.status === "lobby" && (
          <span className="text-ink-muted"> · {t("room.min", { min: room.minPlayers })}</span>
        )}
        <br />
        <span className="text-ink-muted">
          {t(`room.lang.${room.lang}`)} · {t(`room.timers.${room.timers}`)} · {state}
        </span>
      </span>
      <Link
        href={{ pathname: "/salle/[code]", params: { code: room.code } }}
        aria-label={t(joinable ? "room.joinLabel" : "room.watchLabel", { code: room.code })}
        className={buttonClass(joinable ? "primary" : "secondary", "min-h-10")}
      >
        {joinable ? t("room.join") : t("room.watch")}
      </Link>
    </li>
  );
}

export function PublicLobby({ roomsUrl }: { roomsUrl: string }) {
  const t = useTranslations("lobby");
  const [rooms, setRooms] = useState<LobbyEntry[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [clockOffset, setClockOffset] = useState(0);

  useEffect(() => {
    const socket = new ReconnectingWebSocket(lobbySocketUrl(roomsUrl), [], {
      maxEnqueuedMessages: 0,
      maxReconnectionDelay: 15_000,
    });
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const snapshot = parseLobbyMessage(event.data);
      if (!snapshot) return;
      setRooms(snapshot.rooms);
      setClockOffset(snapshot.serverTime - Date.now());
      setStatus("open");
    };
    const onClose = () => setStatus((current) => (current === "open" ? "offline" : current));
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    const keepAlive = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.send(KEEPALIVE_PING);
    }, 30_000);
    return () => {
      clearInterval(keepAlive);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.close();
    };
  }, [roomsUrl]);

  return (
    <section aria-labelledby="lobby-rooms" className="space-y-3">
      <h2 id="lobby-rooms" className="font-display text-3xl">
        {t("page.listTitle")}
      </h2>
      <div aria-live="polite">
        {status === "connecting" && <p className="text-ink-muted">{t("page.connecting")}</p>}
        {status === "offline" && <p className="text-fascist">{t("page.offline")}</p>}
        {status === "open" && rooms.length === 0 && (
          <p className="text-ink-muted">{t("page.empty")}</p>
        )}
      </div>
      {rooms.length > 0 && (
        <ul className="space-y-2" data-testid="lobby-rooms">
          {rooms.map((room) => (
            <RoomRow key={room.code} room={room} clockOffset={clockOffset} />
          ))}
        </ul>
      )}
    </section>
  );
}
