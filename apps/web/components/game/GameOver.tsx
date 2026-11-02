"use client";

import type { PlayerView } from "@sh/engine";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { PartyEmblem } from "./art";
import { RoleFace } from "./cards";
import type { SeatNames } from "./names";

/** Winner, reason, and every role revealed. */
export function GameOver({ view, names }: { view: PlayerView; names: SeatNames }) {
  const t = useTranslations("game");
  const headingId = useId();
  if (view.phase.kind !== "over") return null;
  const { winner, reason } = view.phase;
  const border = winner === "liberal" ? "border-liberal" : "border-fascist";
  const text = winner === "liberal" ? "text-liberal" : "text-fascist";

  return (
    <section
      data-testid="game-over"
      data-winner={winner}
      aria-labelledby={headingId}
      className={`sh-deal rounded-xl border-4 bg-paper-raised p-4 shadow-md ${border}`}
    >
      <div className="flex items-center gap-3">
        <PartyEmblem party={winner} className={`size-14 shrink-0 ${text}`} />
        <div>
          <h2 id={headingId} className={`font-display text-3xl leading-tight sm:text-4xl ${text}`}>
            {t(`over.title.${winner}`)}
          </h2>
          <p className="text-base">{t(`over.reason.${reason}`)}</p>
          {view.me ? (
            <p className="mt-0.5 font-display text-lg">
              {view.me.party === winner ? t("over.youWon") : t("over.youLost")}
            </p>
          ) : null}
        </div>
      </div>
      {view.roles ? (
        <>
          <h3 className="mt-4 font-display text-lg tracking-wide">{t("over.roles")}</h3>
          <ul className="mt-2 grid grid-cols-3 gap-2 min-[520px]:grid-cols-5">
            {view.roles.map((role, seat) => (
              <li
                key={seat}
                className={`flex flex-col items-center gap-1 text-center ${view.seats[seat]?.alive === false ? "opacity-75" : ""}`}
              >
                <RoleFace
                  role={role}
                  label={t(`role.${role}`)}
                  className={`w-20 sm:w-24 ${role === "hitler" ? "ring-4 ring-fascist/40" : ""}`}
                />
                <span className="w-full truncate font-display text-sm leading-tight">
                  {names.name(seat)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
