"use client";

/**
 * Turn alerts for the player in this room (lib/turn-alert): the tab title
 * says "● À vous" while one of their decisions is open, and the phone
 * vibrates once when it starts. Renders the vibration switch (this browser's
 * choice) for seated players during a game, where the browser can vibrate.
 */
import { useId } from "react";
import { useTranslations } from "next-intl";

import { decisionKind } from "@/components/game/ActionPanel";
import { useRoomState } from "@/lib/room-client/store";
import { useTurnAlert, useVibrationPreference } from "@/lib/turn-alert/use-turn-alert";

export function TurnAlerts({ playing }: { playing: boolean }) {
  const t = useTranslations("room");
  const id = useId();
  const turn = useRoomState((s) => s.game?.turn ?? null);
  const me = useRoomState((s) => s.game?.view.me ?? null);
  const vibration = useVibrationPreference();

  const kind = playing && me ? decisionKind(me.legal) : null;
  // Same key as the action panel: other players' votes do not change it.
  const decisionKey = kind !== null && turn !== null ? `${turn}:${kind}` : null;
  useTurnAlert(decisionKey, t("turnAlert.titlePrefix"), vibration.on);

  if (!playing || !me || !vibration.supported) return null;
  return (
    <label htmlFor={id} className="flex min-h-11 w-fit items-center gap-3 text-ink-muted">
      <input
        id={id}
        type="checkbox"
        checked={vibration.on}
        onChange={(event) => vibration.setOn(event.target.checked)}
        className="size-5 shrink-0 accent-ink"
      />
      <span>{t("turnAlert.vibrate")}</span>
    </label>
  );
}
