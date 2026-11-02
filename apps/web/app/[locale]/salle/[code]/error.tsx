"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";

/** The room page could not reach the rooms Worker (or failed otherwise). */
export default function RoomError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("room");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10 text-center">
      <h1 className="font-display text-4xl">{t("unavailable.title")}</h1>
      <p className="mt-4">{t("unavailable.lead")}</p>
      <p className="mt-8">
        <Button onClick={reset}>{t("unavailable.retry")}</Button>
      </p>
    </main>
  );
}
