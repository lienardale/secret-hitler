"use client";

/**
 * The profile page's forms: rename, block by name, unblock, block from the
 * game history, delete the account. Each posts to a server action in
 * app/[locale]/profil/actions.ts, which answers with a `profile.errors.*` key
 * or a notice; the page itself re-renders with the new data (`refresh()`).
 */
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { DISPLAY_NAME_MAX } from "@sh/protocol";

import {
  blockByNameAction,
  blockPlayerAction,
  deleteAccountAction,
  renameAction,
  unblockAction,
  type ProfileState,
} from "@/app/[locale]/profil/actions";
import { inputClass } from "@/components/auth/AuthForms";
import { Button, buttonClass } from "@/components/ui/Button";

import { DATE_TIME } from "./format";

const labelClass = "block font-display text-lg";

function errorOf(state: ProfileState) {
  return state && !state.ok ? state : null;
}

/** The action's error, translated (`rateLimited` carries a wait, `renameTooSoon` a date). */
function ErrorText({ id, state }: { id?: string; state: ProfileState }) {
  const t = useTranslations("profile");
  const format = useFormatter();
  const error = errorOf(state);
  if (!error) return null;
  let message: string;
  if (error.error === "rateLimited") {
    message = t("errors.rateLimited", {
      minutes: Math.max(1, Math.ceil((error.retryAfterSec ?? 60) / 60)),
    });
  } else if (error.error === "renameTooSoon" && error.nextAt !== undefined) {
    message = t("errors.renameTooSoon", {
      date: format.dateTime(new Date(error.nextAt), DATE_TIME),
    });
  } else {
    message = t(`errors.${error.error}`);
  }
  return (
    <p id={id} role="alert" className="text-sm text-fascist">
      {message}
    </p>
  );
}

// -------------------------------------------------------------- rename ----

export function RenameForm({
  currentName,
  lockedUntil,
}: {
  currentName: string;
  lockedUntil: string | null;
}) {
  const t = useTranslations("profile");
  const format = useFormatter();
  const id = useId();
  const [name, setName] = useState(currentName);
  const [state, action, pending] = useActionState<ProfileState, FormData>(renameAction, null);
  const error = errorOf(state);
  return (
    <div className="space-y-3">
      {state?.ok && (
        <p role="status" className="font-semibold">
          {t("account.renamed", { name: state.name ?? currentName })}
        </p>
      )}
      {lockedUntil ? (
        <p className="text-sm text-ink-muted">
          {t("account.renameLocked", { date: format.dateTime(new Date(lockedUntil), DATE_TIME) })}
        </p>
      ) : (
        <form action={action} className="space-y-2" data-testid="rename-form">
          <label htmlFor={`${id}-name`} className={labelClass}>
            {t("account.newName")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`${id}-name`}
              name="displayName"
              required
              minLength={2}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="nickname"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : `${id}-hint`}
              className={inputClass}
            />
            <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
              {t("account.renameSubmit")}
            </Button>
          </div>
          <p id={`${id}-hint`} className="text-sm text-ink-muted">
            {t("account.renameHint")}
          </p>
          <ErrorText id={`${id}-error`} state={state} />
        </form>
      )}
    </div>
  );
}

// -------------------------------------------------------------- blocks ----

export function BlockByNameForm() {
  const t = useTranslations("profile");
  const id = useId();
  const [name, setName] = useState("");
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    async (prev, formData) => {
      const next = await blockByNameAction(prev, formData);
      if (next?.ok) setName("");
      return next;
    },
    null,
  );
  const error = errorOf(state);
  return (
    <form
      action={action}
      className="space-y-2"
      aria-labelledby={`${id}-title`}
      data-testid="block-by-name-form"
    >
      <h3 id={`${id}-title`} className="font-display text-xl">
        {t("blocks.byName")}
      </h3>
      <label htmlFor={`${id}-name`} className="block">
        {t("blocks.nameLabel")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`${id}-name`}
          name="name"
          required
          maxLength={DISPLAY_NAME_MAX * 2}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={inputClass}
        />
        <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
          {t("blocks.submit")}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-sm text-ink-muted">
        {t("blocks.nameHint")}
      </p>
      {state?.ok && (
        <p role="status" className="text-sm font-semibold">
          {t(state.notice === "alreadyBlocked" ? "blocks.alreadyBlocked" : "blocks.blocked", {
            name: state.name ?? "",
          })}
        </p>
      )}
      <ErrorText id={`${id}-error`} state={state} />
    </form>
  );
}

export function UnblockButton({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations("profile");
  const [state, action, pending] = useActionState<ProfileState, FormData>(unblockAction, null);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="userId" value={userId} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={t("blocks.unblockLabel", { name })}
        className="min-h-9 px-3 py-1 text-base"
      >
        {t("blocks.unblock")}
      </Button>
      <ErrorText state={state} />
    </form>
  );
}

/** "Block" next to another account in the game history; "Blocked" once it is. */
export function BlockPlayerButton({
  userId,
  name,
  blocked,
}: {
  userId: string;
  name: string;
  blocked: boolean;
}) {
  const t = useTranslations("profile");
  const [state, action, pending] = useActionState<ProfileState, FormData>(blockPlayerAction, null);
  return (
    <span aria-live="polite" className="inline-flex flex-col items-end gap-1">
      {blocked ? (
        <span className="rounded border border-rule px-2 py-0.5 text-sm text-ink-muted">
          {t("history.blockedTag")}
        </span>
      ) : (
        <form action={action}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={pending}
            aria-label={t("history.blockLabel", { name })}
            className="min-h-9 rounded border border-ink px-2 py-0.5 text-sm hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          >
            {t("history.block")}
          </button>
        </form>
      )}
      <ErrorText state={state} />
    </span>
  );
}

// ------------------------------------------------------------ deletion ----

/**
 * Two steps: the danger button opens the form, which asks for the password
 * (or, without one, the display name typed again) before deleting.
 */
export function DeleteAccountForm({
  hasPassword,
  displayName,
}: {
  hasPassword: boolean;
  displayName: string;
}) {
  const t = useTranslations("profile");
  const locale = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    deleteAccountAction,
    null,
  );
  const error = errorOf(state);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      inputRef.current?.focus();
    } else if (wasOpen.current) {
      openRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return (
      <button
        ref={openRef}
        type="button"
        aria-expanded={false}
        aria-controls={`${id}-form`}
        onClick={() => setOpen(true)}
        className={buttonClass("danger")}
      >
        {t("delete.open")}
      </button>
    );
  }

  return (
    <form id={`${id}-form`} action={action} className="space-y-3" data-testid="delete-account-form">
      <input type="hidden" name="locale" value={locale} />
      {hasPassword ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-input`} className={labelClass}>
            {t("delete.password")}
          </label>
          <input
            ref={inputRef}
            id={`${id}-input`}
            name="password"
            type="password"
            required
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
            className={inputClass}
          />
          <p id={`${id}-hint`} className="text-sm text-ink-muted">
            {t("delete.passwordHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${id}-input`} className={labelClass}>
            {t("delete.name", { name: displayName })}
          </label>
          <input
            ref={inputRef}
            id={`${id}-input`}
            name="confirmName"
            required
            autoComplete="off"
            maxLength={DISPLAY_NAME_MAX * 2}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={inputClass}
          />
        </div>
      )}
      <ErrorText id={`${id}-error`} state={state} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="danger" disabled={pending}>
          {t("delete.submit")}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t("delete.cancel")}
        </Button>
      </div>
    </form>
  );
}
