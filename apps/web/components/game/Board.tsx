"use client";

import {
  FASCIST_POLICIES_TO_WIN,
  HITLER_ZONE,
  LIBERAL_POLICIES_TO_WIN,
  TRACKER_LIMIT,
  VETO_UNLOCK,
  type PlayerView,
} from "@sh/engine";
import { useTranslations } from "next-intl";
import { useId } from "react";

import {
  ChaosIcon,
  DeckIcon,
  DiscardIcon,
  FascistEmblem,
  LiberalEmblem,
  PowerIcon,
  VetoIcon,
} from "./art";
import { PolicyCard } from "./cards";
import { useBoardChanges } from "./motion";
import { policiesLeft, teamComposition } from "./status";

/**
 * Liberal and fascist tracks, election tracker, piles, and two counters: the
 * teams at this table and the policies not enacted yet. A newly enacted
 * policy and the tracker moving up are animated (reduced motion: no motion).
 */
export function Board({ view }: { view: PlayerView }) {
  const t = useTranslations("game");
  const headingId = useId();
  const changes = useBoardChanges(view);
  return (
    <section
      aria-labelledby={headingId}
      className="sh-board @container mx-auto w-full max-w-md space-y-3 rounded-xl border-2 border-ink bg-paper-raised p-3 shadow-sm"
    >
      <h2 id={headingId} className="sr-only">
        {t("table.board")}
      </h2>
      <LiberalTrack enacted={view.liberal} fresh={changes.liberal} />
      <FascistTrack view={view} fresh={changes.fascist} />
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-rule pt-2">
        <ElectionTracker tracker={view.tracker} moved={changes.tracker} />
        <Piles deck={view.deckCount} discard={view.discardCount} />
      </div>
      <Counters view={view} />
    </section>
  );
}

function TrackHeading({
  id,
  label,
  count,
  total,
  tone,
}: {
  id: string;
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  const t = useTranslations("game");
  return (
    <h3 id={id} className={`flex items-baseline justify-between font-display text-sm ${tone}`}>
      <span className="tracking-wide uppercase">{label}</span>
      <span className="text-ink-muted tabular-nums">{t("board.count", { count, total })}</span>
    </h3>
  );
}

function EmptySlot({
  label,
  children,
  zone = false,
}: {
  label: string;
  children?: React.ReactNode;
  zone?: boolean;
}) {
  return (
    <span
      className={`flex aspect-[5/7] w-full flex-col items-center justify-center gap-0.5 rounded-md border-2 border-dashed border-rule p-0.5 text-center text-ink-muted ${zone ? "sh-zone" : ""}`}
    >
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}

function LiberalTrack({ enacted, fresh }: { enacted: number; fresh: boolean }) {
  const t = useTranslations("game");
  const id = useId();
  const name = t("policy.name.L");
  return (
    <div>
      <TrackHeading
        id={id}
        label={t("board.liberalTrack")}
        count={enacted}
        total={LIBERAL_POLICIES_TO_WIN}
        tone="text-liberal"
      />
      <ol
        aria-labelledby={id}
        className="mx-auto mt-1 grid w-5/6 grid-cols-5 gap-1 @[22rem]:gap-1.5"
      >
        {Array.from({ length: LIBERAL_POLICIES_TO_WIN }, (_, i) => {
          const n = i + 1;
          const last = n === LIBERAL_POLICIES_TO_WIN;
          return (
            <li key={i} className="min-w-0">
              {i < enacted ? (
                <>
                  <span className="sr-only">{t("board.slotEnacted", { n, policy: name })}</span>
                  <PolicyCard
                    policy="L"
                    label={name}
                    size="fluid"
                    className={fresh && n === enacted ? "sh-enact" : ""}
                  />
                </>
              ) : (
                <EmptySlot
                  label={
                    last
                      ? t("board.slotWin", { n, label: t("board.liberalWin") })
                      : t("board.slotEmpty", { n })
                  }
                >
                  {last ? (
                    <>
                      <LiberalEmblem className="w-1/2 text-liberal" />
                      <span
                        aria-hidden
                        className="text-[0.5rem] leading-tight font-display uppercase"
                      >
                        {t("board.win")}
                      </span>
                    </>
                  ) : null}
                </EmptySlot>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FascistTrack({ view, fresh }: { view: PlayerView; fresh: boolean }) {
  const t = useTranslations("game");
  const id = useId();
  const name = t("policy.name.F");
  const enacted = view.fascist;
  return (
    <div>
      <TrackHeading
        id={id}
        label={t("board.fascistTrack")}
        count={enacted}
        total={FASCIST_POLICIES_TO_WIN}
        tone="text-fascist"
      />
      <ol aria-labelledby={id} className="mt-1 grid grid-cols-6 gap-1 @[22rem]:gap-1.5">
        {Array.from({ length: FASCIST_POLICIES_TO_WIN }, (_, i) => {
          const n = i + 1;
          const power = view.powerBoard[i] ?? null;
          const last = n === FASCIST_POLICIES_TO_WIN;
          const zone = n > HITLER_ZONE;
          let label = t("board.slotEmpty", { n });
          if (last) label = t("board.slotWin", { n, label: t("board.fascistWin") });
          else if (power) label = t("board.slotPower", { n, power: t(`power.${power}.name`) });
          return (
            <li key={i} className="relative min-w-0">
              {i < enacted ? (
                <>
                  <span className="sr-only">{t("board.slotEnacted", { n, policy: name })}</span>
                  <PolicyCard
                    policy="F"
                    label={name}
                    size="fluid"
                    className={fresh && n === enacted ? "sh-enact" : ""}
                  />
                </>
              ) : (
                <EmptySlot label={label} zone={zone}>
                  {last ? (
                    <FascistEmblem className="w-1/2 text-fascist" />
                  ) : power ? (
                    <PowerIcon power={power} className="w-2/5 text-fascist" />
                  ) : null}
                  {last || power ? (
                    <span
                      aria-hidden
                      className="line-clamp-2 text-[0.45rem] leading-tight font-display uppercase @[22rem]:text-[0.55rem]"
                    >
                      {last ? t("board.win") : power ? t(`power.${power}.short`) : null}
                    </span>
                  ) : null}
                </EmptySlot>
              )}
              {n === VETO_UNLOCK ? (
                <span
                  aria-hidden
                  className={`absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-sm border px-0.5 font-display text-[0.5rem] leading-tight uppercase ${view.vetoUnlocked ? "border-fascist bg-fascist text-paper" : "border-rule bg-paper-raised text-ink-muted"}`}
                >
                  <VetoIcon className="size-2" />
                  {t("board.veto")}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[0.7rem] leading-snug text-ink-muted">
        {enacted >= HITLER_ZONE ? (
          <strong className="font-medium text-fascist">{t("board.hitlerZone")}</strong>
        ) : (
          t("board.hitlerZoneSoon")
        )}{" "}
        {view.vetoUnlocked ? (
          <strong className="font-medium text-fascist">{t("board.vetoUnlocked")}.</strong>
        ) : (
          <span>{t("board.vetoLocked")}.</span>
        )}
      </p>
    </div>
  );
}

function ElectionTracker({ tracker, moved }: { tracker: number; moved: boolean }) {
  const t = useTranslations("game");
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="font-display text-xs tracking-wide text-ink-muted uppercase">
        {t("board.tracker")}
      </h3>
      <div className="mt-1 flex items-center gap-2">
        <ol aria-hidden className="flex items-center gap-1.5">
          {Array.from({ length: TRACKER_LIMIT }, (_, i) => {
            const filled = i < tracker;
            const chaos = i === TRACKER_LIMIT - 1;
            return (
              <li
                key={i}
                className={`flex size-6 items-center justify-center rounded-full border-2 font-display text-xs ${
                  filled ? "border-ink bg-ink text-paper" : "border-rule text-ink-muted"
                } ${chaos && !filled ? "border-fascist text-fascist" : ""} ${
                  moved && i === tracker - 1 ? "sh-token-move" : ""
                }`}
              >
                {chaos ? <ChaosIcon className="size-3.5" /> : i + 1}
              </li>
            );
          })}
        </ol>
        <p className="text-xs leading-tight">
          <span className="block">{t("board.trackerValue", { count: tracker })}</span>
          <span className="block text-ink-muted">
            {t("board.chaos")} · {t("board.chaosHint")}
          </span>
        </p>
      </div>
    </div>
  );
}

function Piles({ deck, discard }: { deck: number; discard: number }) {
  const t = useTranslations("game");
  return (
    <dl className="flex gap-3 text-xs">
      <div className="relative pl-6.5">
        <dt className="font-display tracking-wide text-ink-muted uppercase">
          <DeckIcon className="absolute top-1/2 left-0 size-5 -translate-y-1/2 text-ink-muted" />
          {t("board.deck")}
        </dt>
        <dd className="tabular-nums">{t("board.cards", { count: deck })}</dd>
      </div>
      <div className="relative pl-6.5">
        <dt className="font-display tracking-wide text-ink-muted uppercase">
          <DiscardIcon className="absolute top-1/2 left-0 size-5 -translate-y-1/2 text-ink-muted" />
          {t("board.discard")}
        </dt>
        <dd className="tabular-nums">{t("board.cards", { count: discard })}</dd>
      </div>
    </dl>
  );
}

/**
 * Public counts that help reasoning: who is at this table (official role
 * table) and how many policies of each party are not on the board yet. Not
 * the draw pile's contents: the label says they are spread over the pile, the
 * discard and any hand.
 */
function Counters({ view }: { view: PlayerView }) {
  const t = useTranslations("game");
  const teams = teamComposition(view.playerCount);
  const left = policiesLeft(view);
  return (
    <dl className="grid gap-x-4 gap-y-1 border-t border-rule pt-2 text-xs leading-snug sm:grid-cols-2">
      <div data-testid="teams" data-liberal={teams.liberal} data-fascist={teams.fascist}>
        <dt className="font-display tracking-wide text-ink-muted uppercase">
          {t("board.teams", { count: view.playerCount })}
        </dt>
        <dd>{t("board.teamsValue", teams)}</dd>
      </div>
      <div data-testid="policies-left" data-liberal={left.liberal} data-fascist={left.fascist}>
        <dt className="font-display tracking-wide text-ink-muted uppercase">
          {t("board.policiesLeft")}
        </dt>
        <dd>
          {t("board.policiesLeftValue", left)}{" "}
          <span className="text-ink-muted">{t("board.policiesLeftHint")}</span>
        </dd>
      </div>
    </dl>
  );
}
