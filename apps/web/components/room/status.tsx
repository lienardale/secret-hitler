"use client";

/** Connection banner, closed-room notice and the short notice for refused messages. */
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ErrorCode } from "@sh/protocol";

import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";
import type { ConnectionStatus, RoomClientState } from "@/lib/room-client/state";

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

const KNOWN_CLOSE = new Set([4400, 4403, 4404, 4409, 4410, 4423, 4426, 4429, 4451]);
/** Closes after which reloading the page cannot help. */
const FINAL_CLOSE = new Set([4404, 4410, 4423, 4451]);

/**
 * Why the visitor is not (or no longer) in the room. `cooldown` is the ticket
 * route's refusal of an account that left two public games within 24 h; it
 * comes with no close code.
 */
export function ClosedNotice({
  code,
  cooldown = null,
}: {
  code: number | null;
  cooldown?: RoomClientState["cooldown"];
}) {
  const t = useTranslations("room");
  const format = useFormatter();
  if (cooldown) {
    return (
      <section className="mx-auto max-w-md rounded-lg border-2 border-ink bg-paper-raised p-6 text-center">
        <h1 className="font-display text-3xl">{t("closed.title")}</h1>
        <p className="mt-3">
          {cooldown.until === null
            ? t("closed.cooldownSoon")
            : t("closed.cooldown", {
                time: format.dateTime(new Date(cooldown.until), {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/jouer" className={buttonClass("primary")}>
            {t("closed.publicGames")}
          </Link>
        </div>
      </section>
    );
  }
  const key =
    code !== null && KNOWN_CLOSE.has(code) ? (`closed.c${code}` as const) : "closed.other";
  return (
    <section className="mx-auto max-w-md rounded-lg border-2 border-ink bg-paper-raised p-6 text-center">
      <h1 className="font-display text-3xl">{t("closed.title")}</h1>
      <p className="mt-3">{t(key as "closed.other")}</p>
      {code === 4451 && <p className="mt-2 text-ink-muted">{t("closed.c4451Help")}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {code === 4451 ? (
          // A suspended account: the statement of reasons is on the profile page.
          <>
            <Link href="/profil" className={buttonClass("primary")}>
              {t("closed.profile")}
            </Link>
            <Link href="/" className={buttonClass("secondary")}>
              {t("closed.home")}
            </Link>
          </>
        ) : code === 4403 ? (
          <Link
            href={{
              pathname: "/connexion",
              query: typeof window === "undefined" ? {} : { callbackUrl: window.location.pathname },
            }}
            className={buttonClass("primary")}
          >
            {t("closed.signIn")}
          </Link>
        ) : (
          <Link href="/" className={buttonClass("primary")}>
            {t("closed.home")}
          </Link>
        )}
        {(code === null || !FINAL_CLOSE.has(code)) && (
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
