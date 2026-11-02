"use client";

import { useActionState, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { DISPLAY_NAME_MAX } from "@sh/protocol";

import { saveGuestNameAction, type FormState } from "@/app/[locale]/actions";
import { Button } from "@/components/ui/Button";

/** Asks a guest for a display name, then calls `onSaved` (the cookie is set). */
export function GuestNameForm({
  onSaved,
  defaultName = "",
}: {
  onSaved: () => void;
  defaultName?: string;
}) {
  const t = useTranslations("room");
  const [state, action, pending] = useActionState<FormState, FormData>(saveGuestNameAction, null);
  const id = useId();

  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  const error = state && !state.ok ? state.error : null;
  return (
    <section className="mx-auto max-w-md rounded-lg border-2 border-ink bg-paper-raised p-6 shadow-sm">
      <h1 className="font-display text-3xl">{t("name.title")}</h1>
      <p className="mt-2 text-ink-muted">{t("name.lead")}</p>
      <form action={action} className="mt-6 space-y-3">
        <label htmlFor={`${id}-name`} className="block font-display text-lg">
          {t("name.label")}
        </label>
        <input
          id={`${id}-name`}
          name="name"
          required
          minLength={2}
          maxLength={DISPLAY_NAME_MAX}
          defaultValue={defaultName}
          autoComplete="nickname"
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          aria-invalid={error ? true : undefined}
          className="w-full rounded-md border-2 border-rule bg-paper px-3 py-2 text-lg focus:border-ink focus:outline-none"
        />
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {t("name.hint")}
        </p>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-fascist">
            {t(`errors.${error}`)}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {t("name.save")}
        </Button>
      </form>
    </section>
  );
}
