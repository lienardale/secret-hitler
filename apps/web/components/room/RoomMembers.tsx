"use client";

/**
 * Everyone in the room during and after a game (players in seat order, then
 * spectators), each with the player menu: the game table (components/game)
 * shows the seats but has no room actions. The lobby puts the same menu in its
 * own seat list (Lobby.tsx).
 */
import { useId } from "react";
import { useTranslations } from "next-intl";
import type { RoomView } from "@sh/protocol";

import { MutedTag, PlayerMenu, type MemberView } from "./PlayerMenu";

function MemberItem({
  member,
  isYou,
  spectator,
}: {
  member: MemberView;
  isYou: boolean;
  spectator: boolean;
}) {
  const t = useTranslations("room");
  return (
    <li
      data-testid="room-member"
      className="flex min-h-11 items-center gap-1 rounded-full border border-rule bg-paper pl-3 pr-1"
    >
      <span className="min-w-0 truncate py-1">
        <span className="font-semibold">{member.name}</span>
        {isYou && <span className="text-ink-muted"> ({t("lobby.you")})</span>}
        {spectator && <span className="text-sm text-ink-muted"> · {t("members.spectator")}</span>}
        {member.guest && <span className="text-sm text-ink-muted"> · {t("member.guestTag")}</span>}
      </span>
      <MutedTag pid={member.pid} />
      {isYou ? <span className="w-2" aria-hidden /> : <PlayerMenu member={member} />}
    </li>
  );
}

export function RoomMembers({ room, youPid }: { room: RoomView; youPid: string }) {
  const t = useTranslations("room");
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-lg border-2 border-rule bg-paper-raised px-4 py-3"
    >
      <h2 id={`${id}-title`} className="font-display text-xl">
        {t("members.title")}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {room.players.map((member) => (
          <MemberItem
            key={member.pid}
            member={member}
            isYou={member.pid === youPid}
            spectator={false}
          />
        ))}
        {room.spectators.map((member) => (
          <MemberItem key={member.pid} member={member} isYou={member.pid === youPid} spectator />
        ))}
      </ul>
    </section>
  );
}
