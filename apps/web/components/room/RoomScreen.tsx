"use client";

/**
 * A room page, once the visitor has a guest name: connects to the room and
 * shows the lobby, the game, or why the room is unavailable.
 */
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { RoomProvider, useRoomState } from "@/lib/room-client/store";

import { GameStage } from "./GameStage";
import { GuestNameForm } from "./GuestNameForm";
import { Lobby } from "./Lobby";
import { ClosedNotice, ConnectionBanner, RefusalNotice } from "./status";

function RoomBody({ onNameSaved }: { onNameSaved: () => void }) {
  const t = useTranslations("room");
  const status = useRoomState((s) => s.status);
  const closeCode = useRoomState((s) => s.closeCode);
  const needsName = useRoomState((s) => s.needsName);
  const room = useRoomState((s) => s.room);
  const you = useRoomState((s) => s.you);
  const lastError = useRoomState((s) => s.lastError);

  if (needsName) return <GuestNameForm onSaved={onNameSaved} />;
  if (status === "closed") return <ClosedNotice code={closeCode} />;
  if (!room || !you) {
    return (
      <p role="status" className="py-16 text-center font-display text-2xl text-ink-muted">
        {t("connection.connecting")}
      </p>
    );
  }
  return (
    <>
      <ConnectionBanner status={status} />
      <RefusalNotice error={lastError} />
      <div data-room-status={room.status} data-testid="room">
        {room.status === "lobby" ? (
          <Lobby room={room} youPid={you.pid} />
        ) : (
          <GameStage room={room} youPid={you.pid} />
        )}
      </div>
    </>
  );
}

export function RoomScreen({ code }: { code: string }) {
  // A new name means a new ticket identity: remount the connection.
  const [attempt, setAttempt] = useState(0);
  const onNameSaved = useCallback(() => setAttempt((n) => n + 1), []);
  return (
    <RoomProvider key={attempt} code={code}>
      <RoomBody onNameSaved={onNameSaved} />
    </RoomProvider>
  );
}
