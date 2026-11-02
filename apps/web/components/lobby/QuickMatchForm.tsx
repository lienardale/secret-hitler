"use client";

import { useActionState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { quickMatchAction, type QuickMatchState } from "@/app/[locale]/jouer/actions";
import { Button } from "@/components/ui/Button";

export function QuickMatchForm() {
  const t = useTranslations("lobby");
  const format = useFormatter();
  const locale = useLocale();
  const [state, action, pending] = useActionState<QuickMatchState, FormData>(
    quickMatchAction,
    null,
  );
  const error = state?.ok === false ? state : null;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" disabled={pending} className="w-full text-2xl">
        {t("quick.button")}
      </Button>
      {error && (
        <p role="alert" className="text-fascist">
          {error.error === "cooldown" && error.until
            ? t("errors.cooldown", {
                time: format.dateTime(new Date(error.until), {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })
            : t(`errors.${error.error}`)}
        </p>
      )}
    </form>
  );
}
