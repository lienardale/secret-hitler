"use client";

import { useActionState, useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DISPLAY_NAME_MAX, ROOM_CODE_LENGTH } from "@sh/protocol";

import {
  createRoomAction,
  joinRoomAction,
  type CreateRoomState,
  type FormState,
} from "@/app/[locale]/actions";
import { Button } from "@/components/ui/Button";

const inputClass =
  "w-full rounded-md border-2 border-field bg-paper px-3 py-2 text-lg focus:border-ink focus:outline-none";

function FormError({ id, state }: { id: string; state: FormState | CreateRoomState }) {
  const t = useTranslations("room");
  const common = useTranslations("common");
  if (!state || state.ok) return null;
  return (
    <p id={id} role="alert" className="text-fascist">
      {state.error === "banned" ? common("errors.banned") : t(`errors.${state.error}`)}
    </p>
  );
}

/** `accountName`: a signed-in account plays under its display name (no name field). */
export function CreateRoomForm({
  guestName,
  accountName = null,
}: {
  guestName: string | null;
  accountName?: string | null;
}) {
  const t = useTranslations("room");
  const locale = useLocale();
  const id = useId();
  const [state, action, pending] = useActionState<CreateRoomState, FormData>(
    createRoomAction,
    null,
  );
  const failed = state !== null && !state.ok;
  return (
    <section className="rounded-lg border-2 border-ink bg-paper-raised p-5 shadow-sm">
      <h2 className="font-display text-3xl">{t("home.createTitle")}</h2>
      <p className="mt-2 text-ink-muted">{t("home.createLead")}</p>
      <form action={action} className="mt-5 space-y-3">
        <input type="hidden" name="locale" value={locale} />
        {accountName === null && (
          <>
            <label htmlFor={`${id}-name`} className="block font-display text-lg">
              {t("name.label")}
            </label>
            <input
              id={`${id}-name`}
              name="name"
              required
              minLength={2}
              maxLength={DISPLAY_NAME_MAX}
              defaultValue={guestName ?? ""}
              autoComplete="nickname"
              aria-describedby={failed ? `${id}-error` : `${id}-hint`}
              className={inputClass}
            />
            <p id={`${id}-hint`} className="text-sm text-ink-muted">
              {t("name.hint")}
            </p>
          </>
        )}
        <FormError id={`${id}-error`} state={state} />
        <Button type="submit" disabled={pending} className="w-full">
          {t("home.createButton")}
        </Button>
      </form>
    </section>
  );
}

export function JoinRoomForm() {
  const t = useTranslations("room");
  const locale = useLocale();
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(joinRoomAction, null);
  const failed = state !== null && !state.ok;
  return (
    <section className="rounded-lg border-2 border-rule bg-paper-raised p-5">
      <h2 className="font-display text-3xl">{t("home.joinTitle")}</h2>
      <p className="mt-2 text-ink-muted">{t("home.joinLead")}</p>
      <form action={action} className="mt-5 space-y-3">
        <input type="hidden" name="locale" value={locale} />
        <label htmlFor={`${id}-code`} className="block font-display text-lg">
          {t("home.codeLabel")}
        </label>
        <input
          id={`${id}-code`}
          name="code"
          required
          minLength={ROOM_CODE_LENGTH}
          maxLength={ROOM_CODE_LENGTH + 2}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby={failed ? `${id}-error` : undefined}
          className={`${inputClass} font-display tracking-[0.3em] uppercase`}
        />
        <FormError id={`${id}-error`} state={state} />
        <Button type="submit" variant="secondary" disabled={pending} className="w-full">
          {t("home.joinButton")}
        </Button>
      </form>
    </section>
  );
}
