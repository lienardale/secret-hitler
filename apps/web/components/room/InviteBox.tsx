"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";

/** The room code, big enough to read across a table, and the short invite link. */
const noSubscribe = () => () => {};

export function InviteBox({ code }: { code: string }) {
  const t = useTranslations("room");
  const [copied, setCopied] = useState(false);
  // Browser-only values; the server snapshot keeps the first render identical.
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  const link = `${origin}/r/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard refused (permissions): the link stays visible and selectable.
    }
  }

  async function share() {
    try {
      await navigator.share({ title: t("lobby.shareText"), text: t("lobby.shareText"), url: link });
    } catch {
      // Cancelled by the user.
    }
  }

  return (
    <section className="rounded-lg border-2 border-ink bg-paper-raised p-4 sm:p-5">
      <h2 className="font-display text-2xl">{t("lobby.invite")}</h2>
      <p className="mt-1 text-ink-muted">{t("lobby.inviteLead")}</p>
      <p className="mt-4 flex items-baseline gap-3">
        <span className="text-sm uppercase tracking-widest text-ink-muted">
          {t("lobby.codeLabel")}
        </span>
        <span data-testid="room-code" className="font-display text-5xl tracking-[0.3em]">
          {code}
        </span>
      </p>
      <p className="mt-3 break-all rounded-md border border-rule bg-paper px-3 py-2 font-mono text-sm select-all">
        {link}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? t("lobby.copied") : t("lobby.copy")}
        </Button>
        {canShare && (
          <Button variant="secondary" onClick={share}>
            {t("lobby.share")}
          </Button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? t("lobby.copied") : ""}
      </p>
    </section>
  );
}
