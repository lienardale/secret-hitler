"use client";

import type { MeView } from "@sh/engine";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { CardBack, RoleFace } from "./cards";
import type { SeatNames } from "./names";

/**
 * The viewer's secret role, hidden by default ("privacy mode" for players
 * sitting side by side). Pointer/touch: shown only while pressed and held.
 * Keyboard: Enter or Space toggles it (`aria-pressed`); it hides again when
 * focus leaves the button.
 */
export function RoleCard({ me, names }: { me: MeView; names: SeatNames }) {
  const t = useTranslations("game");
  const [held, setHeld] = useState(false);
  const [toggled, setToggled] = useState(false);
  const revealed = held || toggled;
  const infoId = useId();
  const hintId = useId();

  const release = () => setHeld(false);
  const teammates = me.knownRoles.filter((known) => known.seat !== me.seat);

  return (
    <section
      aria-label={t("roleCard.yourRole")}
      className="sh-role flex gap-3 rounded-xl border-2 border-rule bg-paper-raised p-3 shadow-sm md:w-[22rem]"
    >
      <button
        type="button"
        aria-pressed={revealed}
        aria-describedby={hintId}
        aria-controls={infoId}
        className="sh-hold group w-24 shrink-0 cursor-pointer touch-none rounded-lg select-none focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-28"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setHeld(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          // Pointer clicks are handled by press-and-hold; keyboard clicks (detail 0) toggle.
          if (event.detail === 0) setToggled((value) => !value);
        }}
        onBlur={() => {
          setToggled(false);
          setHeld(false);
        }}
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
              <p className="text-xs">{t(`roleCard.goal.${me.role}`)}</p>
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
