"use client";

/**
 * The moderator action forms: ban (from a report, or by display name), force
 * a rename, dismiss a report, add a note, lift a ban. Each posts to a server
 * action in app/[locale]/admin/actions.ts, which answers with an
 * `admin.errors.*` key or a notice; the page re-renders with the new data
 * (`refresh()`).
 *
 * React resets a form after its action (`.debug/007`): text fields get what
 * was typed back through `defaultValue`. React applies a select's
 * `defaultValue` only when it mounts, so the duration select is keyed by the
 * duration to restore: a new value remounts it, and the form reset then keeps
 * that option.
 */
import { useActionState, useId } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { DISPLAY_NAME_MAX } from "@sh/protocol";

import {
  banAction,
  banByNameAction,
  dismissAction,
  forceRenameAction,
  noteAction,
  unbanAction,
  type AdminError,
  type AdminState,
  type AdminValues,
} from "@/app/[locale]/admin/actions";
import { inputClass } from "@/components/auth/AuthForms";
import { DATE_TIME } from "@/components/profile/format";
import { Button } from "@/components/ui/Button";

import { BAN_DURATIONS, BAN_REASON_MAX, NOTE_MAX } from "./constants";

type Action = (prev: AdminState, formData: FormData) => Promise<AdminState>;
type Field = keyof AdminValues;

const labelClass = "block font-display text-lg";
const hintClass = "text-sm text-ink-muted";
const formClass = "space-y-3 rounded-lg border-2 border-rule bg-paper p-4";

/** Which field an error is about (for `aria-invalid` and `aria-describedby`). */
const ERROR_FIELD: Partial<Record<AdminError, Field>> = {
  reasonRequired: "reason",
  reasonTooLong: "reason",
  noteRequired: "note",
  noteTooLong: "note",
  invalidDuration: "duration",
  playerNotFound: "name",
};

function useAdminAction(action: Action) {
  const [state, run, pending] = useActionState<AdminState, FormData>(action, null);
  return { state, run, pending };
}

/** What was typed before a refusal. */
function typed(state: AdminState, field: Field): string | undefined {
  return state && !state.ok ? state.values?.[field] : undefined;
}

/** Props that tie a field to the form's error when the error is about it. */
function invalidProps(state: AdminState, field: Field, errorId: string, hintId?: string) {
  const invalid = state !== null && !state.ok && ERROR_FIELD[state.error] === field;
  return {
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": invalid ? errorId : hintId,
  } as const;
}

/** The answer: a notice in a polite live region, or the error as an alert. */
function Outcome({ state, errorId }: { state: AdminState; errorId: string }) {
  const t = useTranslations("admin");
  const format = useFormatter();
  const lines: string[] = [];
  if (state?.ok) {
    switch (state.notice) {
      case "banned":
        lines.push(
          state.expiresAt === null
            ? t("notices.bannedPermanent", { name: state.name })
            : t("notices.banned", {
                name: state.name,
                date: format.dateTime(new Date(state.expiresAt), DATE_TIME),
              }),
          state.live.reached
            ? t("notices.banLive", { count: state.live.count })
            : t("notices.banUnreachable"),
        );
        break;
      case "renamed":
        lines.push(
          t("notices.renamed", { from: state.from, to: state.to }),
          state.live.reached
            ? t("notices.renameLive", { count: state.live.count })
            : t("notices.renameUnreachable"),
        );
        break;
      case "unbanned":
        lines.push(t("notices.unbanned", { name: state.name }));
        break;
      case "dismissed":
      case "noted":
        lines.push(t(`notices.${state.notice}`));
        break;
    }
  }
  return (
    <>
      <div role="status" className="space-y-1 text-sm font-semibold">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {state && !state.ok && (
        <p id={errorId} role="alert" className="text-sm font-semibold text-fascist">
          {t(`errors.${state.error}`)}
        </p>
      )}
    </>
  );
}

function NoteField({
  id,
  state,
  label,
  required = false,
}: {
  id: string;
  state: AdminState;
  label?: string;
  required?: boolean;
}) {
  const t = useTranslations("admin");
  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-note`} className={labelClass}>
        {label ?? t("actions.note")}
      </label>
      <textarea
        id={`${id}-note`}
        name="note"
        rows={2}
        required={required}
        maxLength={NOTE_MAX}
        defaultValue={typed(state, "note")}
        className={inputClass}
        {...invalidProps(state, "note", `${id}-error`, `${id}-note-hint`)}
      />
      <p id={`${id}-note-hint`} className={hintClass}>
        {t("actions.noteHint")}
      </p>
    </div>
  );
}

/** Duration, reason (shown to the player) and the internal note. */
function BanFields({ id, state }: { id: string; state: AdminState }) {
  const t = useTranslations("admin");
  return (
    <>
      <div className="space-y-1">
        <label htmlFor={`${id}-duration`} className={labelClass}>
          {t("actions.ban.duration")}
        </label>
        <select
          key={typed(state, "duration") ?? ""}
          id={`${id}-duration`}
          name="duration"
          required
          defaultValue={typed(state, "duration") ?? ""}
          className={inputClass}
          {...invalidProps(state, "duration", `${id}-error`)}
        >
          <option value="" disabled>
            {t("actions.ban.choose")}
          </option>
          {BAN_DURATIONS.map((duration) => (
            <option key={duration} value={duration}>
              {t(`actions.ban.durations.${duration}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className={labelClass}>
          {t("actions.ban.reason")}
        </label>
        <textarea
          id={`${id}-reason`}
          name="reason"
          rows={3}
          required
          maxLength={BAN_REASON_MAX}
          defaultValue={typed(state, "reason")}
          className={inputClass}
          {...invalidProps(state, "reason", `${id}-error`, `${id}-reason-hint`)}
        />
        <p id={`${id}-reason-hint`} className={hintClass}>
          {t("actions.ban.reasonHint")}
        </p>
      </div>
      <NoteField id={id} state={state} />
    </>
  );
}

/** "Ban the player", on a report. */
export function BanForm({ userId, reportId }: { userId: string; reportId?: string }) {
  const t = useTranslations("admin");
  const id = useId();
  const { state, run, pending } = useAdminAction(banAction);
  return (
    <form action={run} aria-labelledby={`${id}-title`} className={formClass} data-testid="ban-form">
      <h3 id={`${id}-title`} className="font-display text-2xl">
        {t("actions.ban.title")}
      </h3>
      <input type="hidden" name="userId" value={userId} />
      {reportId && <input type="hidden" name="reportId" value={reportId} />}
      <BanFields id={id} state={state} />
      <Outcome state={state} errorId={`${id}-error`} />
      <Button type="submit" variant="danger" disabled={pending}>
        {t("actions.ban.submit")}
      </Button>
    </form>
  );
}

/** "Ban by display name", on the bans page (notices received by e-mail). */
export function BanByNameForm() {
  const t = useTranslations("admin");
  const id = useId();
  const { state, run, pending } = useAdminAction(banByNameAction);
  return (
    <form
      action={run}
      aria-labelledby={`${id}-title`}
      className={formClass}
      data-testid="ban-by-name-form"
    >
      <h2 id={`${id}-title`} className="font-display text-2xl">
        {t("bans.byName.title")}
      </h2>
      <p className={hintClass}>{t("bans.byName.lead")}</p>
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className={labelClass}>
          {t("bans.byName.name")}
        </label>
        <input
          id={`${id}-name`}
          name="name"
          required
          maxLength={DISPLAY_NAME_MAX * 2}
          autoComplete="off"
          defaultValue={typed(state, "name")}
          className={inputClass}
          {...invalidProps(state, "name", `${id}-error`)}
        />
      </div>
      <BanFields id={id} state={state} />
      <Outcome state={state} errorId={`${id}-error`} />
      <Button type="submit" variant="danger" disabled={pending}>
        {t("bans.byName.submit")}
      </Button>
    </form>
  );
}

/** "Force a rename": the account becomes `Player NNNNN`. */
export function ForceRenameForm({ userId, reportId }: { userId: string; reportId?: string }) {
  const t = useTranslations("admin");
  const id = useId();
  const { state, run, pending } = useAdminAction(forceRenameAction);
  return (
    <form
      action={run}
      aria-labelledby={`${id}-title`}
      className={formClass}
      data-testid="rename-form"
    >
      <h3 id={`${id}-title`} className="font-display text-2xl">
        {t("actions.rename.title")}
      </h3>
      <p>{t("actions.rename.lead")}</p>
      <input type="hidden" name="userId" value={userId} />
      {reportId && <input type="hidden" name="reportId" value={reportId} />}
      <NoteField id={id} state={state} />
      <Outcome state={state} errorId={`${id}-error`} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {t("actions.rename.submit")}
      </Button>
    </form>
  );
}

/**
 * "Dismiss". Stays mounted once the report is closed (`closed`) so the
 * confirmation stays on screen after the page refreshes; only the form goes.
 */
export function DismissForm({ reportId, closed = false }: { reportId: string; closed?: boolean }) {
  const t = useTranslations("admin");
  const id = useId();
  const { state, run, pending } = useAdminAction(dismissAction);
  if (closed) {
    return state?.ok ? <Outcome state={state} errorId={`${id}-error`} /> : null;
  }
  return (
    <form
      action={run}
      aria-labelledby={`${id}-title`}
      className={formClass}
      data-testid="dismiss-form"
    >
      <h3 id={`${id}-title`} className="font-display text-2xl">
        {t("actions.dismiss.title")}
      </h3>
      <p>{t("actions.dismiss.lead")}</p>
      <input type="hidden" name="reportId" value={reportId} />
      <NoteField id={id} state={state} />
      <Outcome state={state} errorId={`${id}-error`} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {t("actions.dismiss.submit")}
      </Button>
    </form>
  );
}

/** A note on the report and/or the account. */
export function NoteForm({ reportId, userId }: { reportId?: string; userId?: string }) {
  const t = useTranslations("admin");
  const id = useId();
  const { state, run, pending } = useAdminAction(noteAction);
  return (
    <form
      action={run}
      aria-labelledby={`${id}-title`}
      className={formClass}
      data-testid="note-form"
    >
      <h3 id={`${id}-title`} className="font-display text-2xl">
        {t("actions.addNote.title")}
      </h3>
      {reportId && <input type="hidden" name="reportId" value={reportId} />}
      {userId && <input type="hidden" name="userId" value={userId} />}
      <NoteField id={id} state={state} label={t("actions.addNote.label")} required />
      <Outcome state={state} errorId={`${id}-error`} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {t("actions.addNote.submit")}
      </Button>
    </form>
  );
}

/** "Lift" next to a ban on the bans page. */
export function UnbanButton({ banId, name }: { banId: string; name: string }) {
  const t = useTranslations("admin");
  const id = useId();
  const { state, run, pending } = useAdminAction(unbanAction);
  return (
    <form action={run} className="space-y-1">
      <input type="hidden" name="banId" value={banId} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={t("bans.unbanLabel", { name })}
        className="min-h-9 px-3 py-1 text-base"
      >
        {t("bans.unban")}
      </Button>
      <Outcome state={state} errorId={`${id}-error`} />
    </form>
  );
}
