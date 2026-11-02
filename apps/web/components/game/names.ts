"use client";

import type { Seat } from "@sh/engine";
import type { PlayerSlot } from "@sh/protocol";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

export interface SeatNames {
  /** The player's name as chosen in the room. */
  plain(seat: Seat): string;
  /** The player's name, marked "(you)" for the viewer. */
  name(seat: Seat): string;
  /** Names joined for the locale: "Ada, Basile and Chloé". */
  list(seats: readonly Seat[]): string;
}

export function useSeatNames(players: readonly PlayerSlot[], me: Seat | null): SeatNames {
  const t = useTranslations("game");
  const locale = useLocale();
  return useMemo(() => {
    const plain = (seat: Seat) => players[seat]?.name ?? t("seat.fallback", { n: seat + 1 });
    const name = (seat: Seat) =>
      seat === me ? t("seat.nameYou", { name: plain(seat) }) : plain(seat);
    const format = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    return { plain, name, list: (seats) => format.format(seats.map(name)) };
  }, [players, me, t, locale]);
}
