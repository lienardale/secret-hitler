"use client";

/** Connection banner, closed-room notice and the short notice for refused messages. */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ErrorCode } from "@sh/protocol";

import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";
import type { ConnectionStatus } from "@/lib/room-client/state";

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  const t = useTranslations("room");
  if (status !== "reconnecting") return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-40 bg-fascist px-4 py-2 text-center font-semibold text-paper shadow"
    >
      {t("connection.reconnecting")}
    </div>
  );
}

const KNOWN_CLOSE = new Set([4400, 4403, 4404, 4409, 4410, 4423, 4426, 4429]);

export function ClosedNotice({ code }: { code: number | null }) {
  const t = useTranslations("room");
  const key =
    code !== null && KNOWN_CLOSE.has(code) ? (`closed.c${code}` as const) : "closed.other";
  return (
    <section className="mx-auto max-w-md rounded-lg border-2 border-ink bg-paper-raised p-6 text-center">
      <h1 className="font-display text-3xl">{t("closed.title")}</h1>
      <p className="mt-3">{t(key as "closed.other")}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonClass("primary")}>
          {t("closed.home")}
        </Link>
        {code !== 4423 && code !== 4404 && code !== 4410 && (
          <button
            type="button"
            className={buttonClass("secondary")}
            onClick={() => window.location.reload()}
          >
            {t("closed.reload")}
          </button>
        )}
      </div>
    </section>
  );
}

const ROOM_ERROR = /^[a-z_]+$/;

/** Shows the room's latest refusal for a few seconds. */
export function RefusalNotice({ error }: { error: { code: ErrorCode; at: number } | null }) {
  const t = useTranslations("room");
  // The refusal is shown until its timer marks it as dismissed.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const visible = error && error.at !== dismissedAt ? error : null;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setDismissedAt(error.at), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const code = visible?.code;
  const key = code && ROOM_ERROR.test(code) ? (`notices.${code}` as const) : "notices.engine";
  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      {visible && (
        <p className="rounded-md border-2 border-ink bg-paper-raised px-4 py-2 shadow-lg">
          {t(key as "notices.engine")}
        </p>
      )}
    </div>
  );
}
