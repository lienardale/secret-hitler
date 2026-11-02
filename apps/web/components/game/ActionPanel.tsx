"use client";

import type { Action, MeView, PlayerView, Policy, Seat } from "@sh/engine";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { PowerIcon, VetoIcon } from "./art";
import { PolicyCard } from "./cards";
import { InitialsBadge } from "./InitialsBadge";
import type { SeatNames } from "./names";
import { voteWarnings, waitingVoters } from "./status";
import { BALLOT, BUTTON, CHOICE, HAND_CARD } from "./ui";
import { VoteWarnings } from "./VoteWarnings";

/** The kind of decision the viewer faces, from their legal actions. */
export type DecisionKind =
  | "nominate"
  | "vote"
  | "presidentDiscard"
  | "chancellorEnact"
  | "respondVeto"
  | "investigate"
  | "acknowledgePeek"
  | "specialElection"
  | "execute";

export function decisionKind(legal: readonly Action[]): DecisionKind | null {
  const first = legal[0];
  if (!first) return null;
  // `proposeVeto` only ever comes with `chancellorEnact`.
  return first.type === "proposeVeto" ? "chancellorEnact" : first.type;
}

function targetsOf(legal: readonly Action[], type: Action["type"]): Seat[] {
  return legal.flatMap((action) =>
    action.type === type && "target" in action ? [action.target] : [],
  );
}

function indicesOf(legal: readonly Action[], type: "presidentDiscard" | "chancellorEnact") {
  return legal.flatMap((action) => (action.type === type ? [action.index] : []));
}

/** Text inputs keep focus when a turn starts (someone typing in the chat). */
function isTyping(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

interface PanelProps {
  view: PlayerView;
  me: MeView;
  names: SeatNames;
  /** Initials per seat (index = seat), shown in the player pickers. */
  initials: readonly string[];
  turn: number;
  onAction: (action: Action) => void;
  pending: boolean;
}

/**
 * What the viewer must do now. Only actions from `me.legal` are offered.
 * When a decision starts, focus moves to the panel heading and a polite live
 * region announces it.
 */
export function ActionPanel({ view, me, names, initials, turn, onAction, pending }: PanelProps) {
  const t = useTranslations("game");
  const kind = decisionKind(me.legal);
  // Not view.seq: other players' votes must not move focus.
  const decisionKey = kind ? `${turn}:${kind}` : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (decisionKey === null || isTyping()) return;
    headingRef.current?.focus();
  }, [decisionKey]);

  return (
    <section
      data-testid="action-panel"
      // Focus target when the investigation panel above it closes.
      tabIndex={-1}
      aria-labelledby={kind ? headingId : undefined}
      aria-busy={pending}
      className={`sh-panel min-w-0 rounded-xl border-2 p-3 shadow-sm focus:outline-none ${
        kind ? "sh-your-turn border-ink bg-paper-raised" : "border-rule bg-paper-raised/60"
      }`}
    >
      <div aria-live="polite" className="sr-only">
        {kind ? t(`action.announce.${kind}`) : ""}
      </div>
      {kind ? (
        <>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-2 font-display text-2xl leading-tight focus:outline-none focus-visible:underline"
          >
            {view.phase.kind === "executive" ? (
              <PowerIcon power={view.phase.power} className="size-6 text-fascist" />
            ) : null}
            {kind === "respondVeto" ? <VetoIcon className="size-6 text-fascist" /> : null}
            {t(`action.${kind}.title`)}
          </h2>
          <Decision
            key={decisionKey}
            kind={kind}
            view={view}
            me={me}
            names={names}
            initials={initials}
            onAction={onAction}
            pending={pending}
          />
          {pending ? (
            <p role="status" className="mt-2 text-sm text-ink-muted">
              {t("action.pending")}
            </p>
          ) : null}
        </>
      ) : (
        <IdleStatus view={view} me={me} />
      )}
    </section>
  );
}

function IdleStatus({ view, me }: { view: PlayerView; me: MeView }) {
  const t = useTranslations("game");
  const alive = view.seats[me.seat]?.alive ?? true;
  let text = t("action.idle");
  if (!alive) text = t("action.dead");
  else if (view.phase.kind === "vote" && !waitingVoters(view).includes(me.seat)) {
    text = t("action.voted");
  }
  return <p className="text-sm text-ink-muted">{text}</p>;
}

interface DecisionProps {
  kind: DecisionKind;
  view: PlayerView;
  me: MeView;
  names: SeatNames;
  initials: readonly string[];
  onAction: (action: Action) => void;
  pending: boolean;
}

function Decision({ kind, view, me, names, initials, onAction, pending }: DecisionProps) {
  const t = useTranslations("game");
  const legal = me.legal;
  const pickerProps = { names, initials, disabled: pending };
  switch (kind) {
    case "nominate":
      return (
        <>
          <Hint>{t("action.nominate.hint")}</Hint>
          <VoteWarnings warnings={voteWarnings(view)} className="mt-2" />
          <SeatPicker
            targets={targetsOf(legal, "nominate")}
            {...pickerProps}
            confirmLabel={(name) => t("action.nominateConfirm", { name })}
            onConfirm={(target) => onAction({ type: "nominate", target })}
          />
        </>
      );
    case "vote":
      return <VoteDecision view={view} names={names} onAction={onAction} pending={pending} />;
    case "presidentDiscard":
      return (
        <HandPicker
          hand={me.hand ?? []}
          indices={indicesOf(legal, "presidentDiscard")}
          hint={
            view.phase.kind === "presidentDiscard"
              ? t("action.presidentDiscard.hint", { chancellor: names.name(view.phase.chancellor) })
              : null
          }
          handLabel={t("action.presidentDiscard.hand")}
          confirmLabel={(policy) => t("action.discardConfirm", { policy })}
          onConfirm={(index) => onAction({ type: "presidentDiscard", index })}
          disabled={pending}
        />
      );
    case "chancellorEnact": {
      const canVeto = legal.some((action) => action.type === "proposeVeto");
      const refused = view.phase.kind === "chancellorEnact" && view.phase.vetoRefused;
      const president = names.name(view.president);
      return (
        <>
          {refused ? (
            <p className="mt-1 rounded-md border-l-4 border-fascist bg-paper px-2 py-1 text-sm">
              {t("action.chancellorEnact.vetoRefused", { president })}
            </p>
          ) : null}
          <HandPicker
            hand={me.hand ?? []}
            indices={indicesOf(legal, "chancellorEnact")}
            hint={t("action.chancellorEnact.hint")}
            handLabel={t("action.chancellorEnact.hand")}
            confirmLabel={(policy) => t("action.enactConfirm", { policy })}
            onConfirm={(index) => onAction({ type: "chancellorEnact", index })}
            disabled={pending}
          />
          {canVeto ? (
            <div className="mt-3 border-t border-rule pt-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => onAction({ type: "proposeVeto" })}
                className={BUTTON.outline}
              >
                <VetoIcon className="size-4" />
                {t("action.veto.propose")}
              </button>
              <Hint>{t("action.veto.hint", { president })}</Hint>
            </div>
          ) : null}
        </>
      );
    }
    case "respondVeto":
      return (
        <>
          <p className="mt-1 text-sm">
            {view.phase.kind === "vetoResponse"
              ? t("action.respondVeto.body", { chancellor: names.name(view.phase.chancellor) })
              : null}
          </p>
          {view.tracker === 2 ? (
            <p className="mt-2 rounded-md border-l-4 border-fascist bg-paper px-2 py-1 text-sm">
              {t("action.respondVeto.chaosWarning")}
            </p>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onAction({ type: "respondVeto", agree: true })}
              className={BUTTON.solid}
            >
              {t("action.respondVeto.agree")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onAction({ type: "respondVeto", agree: false })}
              className={BUTTON.outline}
            >
              {t("action.respondVeto.refuse")}
            </button>
          </div>
        </>
      );
    case "investigate":
      return (
        <>
          <Hint>{t("action.investigate.hint")}</Hint>
          <p className="mt-1 text-sm">{t("action.investigate.lie")}</p>
          <SeatPicker
            targets={targetsOf(legal, "investigate")}
            {...pickerProps}
            confirmLabel={(name) => t("action.investigateConfirm", { name })}
            onConfirm={(target) => onAction({ type: "investigate", target })}
          />
        </>
      );
    case "acknowledgePeek":
      return <PeekDecision peek={me.peek ?? []} onAction={onAction} pending={pending} />;
    case "specialElection":
      return (
        <>
          <Hint>{t("action.specialElection.hint")}</Hint>
          <SeatPicker
            targets={targetsOf(legal, "specialElection")}
            {...pickerProps}
            confirmLabel={(name) => t("action.specialElectionConfirm", { name })}
            onConfirm={(target) => onAction({ type: "specialElection", target })}
          />
        </>
      );
    case "execute":
      return (
        <>
          <Hint>{t("action.execute.hint")}</Hint>
          <SeatPicker
            targets={targetsOf(legal, "execute")}
            {...pickerProps}
            danger
            confirmLabel={(name) => t("action.executeConfirm", { name })}
            onConfirm={(target) => onAction({ type: "execute", target })}
          />
        </>
      );
  }
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-sm text-ink-muted">{children}</p>;
}

/**
 * Pick a player, then confirm. Clicking a selected player deselects them, so
 * every enabled button changes something. `danger` adds a second
 * confirmation (execution), still inside the panel.
 */
function SeatPicker({
  targets,
  names,
  initials,
  confirmLabel,
  onConfirm,
  disabled,
  danger = false,
}: {
  targets: Seat[];
  names: SeatNames;
  initials: readonly string[];
  confirmLabel: (name: string) => string;
  onConfirm: (target: Seat) => void;
  disabled: boolean;
  danger?: boolean;
}) {
  const t = useTranslations("game");
  const [selected, setSelected] = useState<Seat | null>(null);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const choice = selected !== null && targets.includes(selected) ? selected : null;

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  return (
    <div className="mt-3">
      <div
        role="group"
        aria-label={t("action.pick.label")}
        className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-3"
      >
        {targets.map((seat) => (
          <button
            key={seat}
            type="button"
            aria-pressed={choice === seat}
            disabled={disabled || confirming}
            onClick={() => setSelected(choice === seat ? null : seat)}
            className={CHOICE}
          >
            <span className="flex min-w-0 items-center gap-2">
              <InitialsBadge initials={initials[seat] ?? ""} />
              <span className="truncate">{names.plain(seat)}</span>
            </span>
          </button>
        ))}
      </div>
      {confirming && choice !== null ? (
        <div
          role="alertdialog"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className="mt-3 rounded-lg border-2 border-fascist bg-paper p-3"
        >
          <p id={titleId} className="font-display text-xl text-fascist">
            {t("action.execute.confirmTitle", { name: names.plain(choice) })}
          </p>
          <p id={bodyId} className="text-sm">
            {t("action.execute.confirmBody")}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button
              ref={cancelRef}
              type="button"
              disabled={disabled}
              onClick={() => setConfirming(false)}
              className={BUTTON.outline}
            >
              {t("action.execute.cancel")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onConfirm(choice)}
              className={BUTTON.danger}
            >
              {t("action.execute.yes", { name: names.plain(choice) })}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || choice === null}
          onClick={() => {
            if (choice === null) return;
            if (danger) setConfirming(true);
            else onConfirm(choice);
          }}
          className={`mt-3 w-full ${danger ? BUTTON.danger : BUTTON.solid}`}
        >
          {choice === null ? t("action.pick.prompt") : confirmLabel(names.plain(choice))}
        </button>
      )}
    </div>
  );
}

/** Choose one policy from the hand, then confirm. */
function HandPicker({
  hand,
  indices,
  hint,
  handLabel,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  hand: Policy[];
  indices: number[];
  hint: string | null;
  handLabel: string;
  confirmLabel: (policy: Policy) => string;
  onConfirm: (index: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations("game");
  const [selected, setSelected] = useState<number | null>(null);
  const choice = selected !== null && indices.includes(selected) ? selected : null;
  const chosenPolicy = choice !== null ? hand[choice] : undefined;

  return (
    <div className="mt-1">
      {hint ? <Hint>{hint}</Hint> : null}
      <div role="group" aria-label={handLabel} className="mt-3 flex justify-center gap-3">
        {hand.map((policy, index) => {
          const pressed = choice === index;
          return (
            <button
              key={index}
              type="button"
              aria-pressed={pressed}
              aria-label={t(`policy.card.${policy}`)}
              disabled={disabled || !indices.includes(index)}
              onClick={() => setSelected(pressed ? null : index)}
              className={`${HAND_CARD} ${pressed ? "sh-picked" : ""}`}
            >
              <PolicyCard policy={policy} label={t(`policy.name.${policy}`)} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={disabled || choice === null}
        onClick={() => {
          if (choice !== null) onConfirm(choice);
        }}
        className={`${BUTTON.solid} mt-4 w-full`}
      >
        {chosenPolicy ? confirmLabel(chosenPolicy) : t("action.selectCard")}
      </button>
    </div>
  );
}

function VoteDecision({
  view,
  names,
  onAction,
  pending,
}: {
  view: PlayerView;
  names: SeatNames;
  onAction: (action: Action) => void;
  pending: boolean;
}) {
  const t = useTranslations("game");
  const nominee = view.phase.kind === "vote" ? view.phase.nominee : null;
  return (
    <>
      {nominee !== null ? (
        <p className="mt-1 text-sm">
          {t("action.vote.government", {
            president: names.name(view.president),
            nominee: names.name(nominee),
          })}
        </p>
      ) : null}
      <VoteWarnings warnings={voteWarnings(view)} className="mt-2" />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => onAction({ type: "vote", ja: true })}
          className={`${BALLOT} sh-ballot-ja border-ink bg-paper text-ink`}
        >
          <span className="sr-only">{t("action.vote.prefix")} </span>
          <span className="font-display text-4xl leading-none sm:text-5xl">
            {t("action.vote.ja")}
          </span>
          <span className="text-xs tracking-widest uppercase">{t("action.vote.jaMeaning")}</span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onAction({ type: "vote", ja: false })}
          className={`${BALLOT} sh-ballot-nein border-ink bg-ink text-paper`}
        >
          <span className="sr-only">{t("action.vote.prefix")} </span>
          <span className="font-display text-4xl leading-none sm:text-5xl">
            {t("action.vote.nein")}
          </span>
          <span className="text-xs tracking-widest uppercase">{t("action.vote.neinMeaning")}</span>
        </button>
      </div>
      <Hint>{t("action.vote.secret")}</Hint>
    </>
  );
}

function PeekDecision({
  peek,
  onAction,
  pending,
}: {
  peek: Policy[];
  onAction: (action: Action) => void;
  pending: boolean;
}) {
  const t = useTranslations("game");
  return (
    <>
      <Hint>{t("action.acknowledgePeek.hint")}</Hint>
      <ol className="mt-3 flex justify-center gap-3">
        {peek.map((policy, index) => (
          <li key={index} className="flex flex-col items-center gap-1">
            <PolicyCard policy={policy} label={t(`policy.name.${policy}`)} className="sh-deal" />
            <span className="font-display text-sm text-ink-muted">
              {t("action.acknowledgePeek.position", { n: index + 1 })}
            </span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={pending}
        onClick={() => onAction({ type: "acknowledgePeek" })}
        className={`${BUTTON.solid} mt-4 w-full`}
      >
        {t("action.acknowledgePeek.done")}
      </button>
    </>
  );
}
