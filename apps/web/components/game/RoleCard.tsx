"use client";

import { HITLER_KNOWS_FASCISTS_MAX_PLAYERS, type MeView, type PlayerCount } from "@sh/engine";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { CardBack, RoleFace } from "./cards";
import { HOLD, useHoldToReveal } from "./hold";
import type { SeatNames } from "./names";

/**
 * The viewer's secret role, hidden by default ("privacy mode" for players
 * sitting side by side). Pointer/touch: shown only while pressed and held.
 * Keyboard: Enter or Space toggles it (`aria-pressed`); it hides again when
 * focus leaves the button. The card beckons until it is first revealed.
 */
export function RoleCard({
  me,
  names,
  playerCount,
}: {
  me: MeView;
  names: SeatNames;
  playerCount: PlayerCount;
}) {
  const t = useTranslations("game");
  const { revealed, buttonProps } = useHoldToReveal();
  // Once per mount: stop beckoning after the first look.
  const [seen, setSeen] = useState(false);
  if (revealed && !seen) setSeen(true);
  const infoId = useId();
  const hintId = useId();

  const teammates = me.knownRoles.filter((known) => known.seat !== me.seat);
  const small = playerCount <= HITLER_KNOWS_FASCISTS_MAX_PLAYERS;
  const knows =
    me.role === "liberal"
      ? null
      : (`roleCard.knows.${me.role}.${small ? "small" : "large"}` as const);

  return (
    <section
      aria-label={t("roleCard.yourRole")}
      className="sh-role flex gap-3 rounded-xl border-2 border-rule bg-paper-raised p-3 shadow-sm md:w-[22rem]"
    >
      <button
        type="button"
        aria-describedby={hintId}
        aria-controls={infoId}
        data-unseen={seen ? undefined : "true"}
        className={`${HOLD} group w-24 shrink-0 touch-none self-start rounded-lg focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-28 ${seen ? "" : "sh-unseen"}`}
        {...buttonProps}
      >
        <span className="sr-only">{t("roleCard.hold")}</span>
        <span key={revealed ? "face" : "back"} className="sh-flip block" aria-hidden>
          {revealed ? (
            <RoleFace
              role={me.role}
              label={t(`role.${me.role}`)}
              partyLabel={t("roleCard.party", { party: me.party })}
              className="w-full"
            />
          ) : (
            <CardBack label={t("roleCard.hidden")} className="w-full" />
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1 text-sm">
        <p className="font-display text-base leading-tight">{t("roleCard.hold")}</p>
        <p id={hintId} className="mt-0.5 text-xs text-ink-muted">
          {t("roleCard.holdHint")}
        </p>
        <div id={infoId} aria-live="polite" className="mt-2">
          {revealed ? (
            <div className="space-y-2">
              <p>
                <span className="block font-display text-xs tracking-wide text-ink-muted uppercase">
                  {t("roleCard.yourRole")}
                </span>
                <strong
                  className={`font-display text-lg ${me.party === "liberal" ? "text-liberal" : "text-fascist"}`}
                >
                  {t(`role.${me.role}`)}
                </strong>{" "}
                <span className="text-ink-muted">({t("roleCard.party", { party: me.party })})</span>
              </p>
              <div>
                <h3 className="font-display text-xs tracking-wide text-ink-muted uppercase">
                  {t("roleCard.toWin")}
                </h3>
                <p className="mt-0.5 text-xs">{t(`roleCard.goal.${me.role}`)}</p>
              </div>
              <div>
                <h3 className="font-display text-xs tracking-wide text-ink-muted uppercase">
                  {t("roleCard.known")}
                </h3>
                {teammates.length > 0 ? (
                  <ul className="mt-0.5 text-xs">
                    {teammates.map((known) => (
                      <li key={known.seat}>
                        {t("roleCard.knownRole", {
                          name: names.plain(known.seat),
                          role: t(`role.${known.role}`),
                        })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 text-xs">{t(`roleCard.knownNone.${me.role}`)}</p>
                )}
                {knows ? <p className="mt-0.5 text-xs text-ink-muted">{t(knows)}</p> : null}
              </div>
              {me.investigations.length > 0 ? (
                <div>
                  <h3 className="font-display text-xs tracking-wide text-ink-muted uppercase">
                    {t("roleCard.investigations")}
                  </h3>
                  <ul className="mt-0.5 text-xs">
                    {me.investigations.map((inv) => (
                      <li key={inv.target}>
                        {t("roleCard.investigation", {
                          name: names.plain(inv.target),
                          party: inv.party,
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
