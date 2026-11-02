import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ResendVerificationButton } from "@/components/auth/AuthForms";
import { DATE_ONLY, DATE_TIME } from "@/components/profile/format";
import { GameHistory } from "@/components/profile/GameHistory";
import {
  BlockByNameForm,
  DeleteAccountForm,
  RenameForm,
  UnblockButton,
} from "@/components/profile/ProfileForms";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClass } from "@/components/ui/Button";
import { requireOnboardedUser } from "@/lib/auth/current-user";
import { nextRenameAt } from "@/lib/auth/display-name";
import { CONTACT_EMAIL } from "@/lib/contact";
import { prisma } from "@/lib/db/prisma";
import { emailVerificationShown, getEnv } from "@/lib/env";
import { userGameHistory } from "@/lib/games/history";
import { getPathname, Link } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";
import { activeBan, type ActiveBan } from "@/lib/moderation/bans";
import { listBlocked } from "@/lib/players/manage";

/** Games per history page. */
const PAGE_SIZE = 20;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/profil">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("meta.title"), robots: { index: false } };
}

/** `?before=<ISO date>`: the `endedAt` of the last game on the previous page. */
function parseBefore(value: string | string[] | undefined): Date | undefined {
  if (typeof value !== "string" || value.length > 40) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function Section({
  id,
  title,
  danger = false,
  children,
}: {
  id: string;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`space-y-4 rounded-lg border-2 bg-paper-raised p-5 shadow-sm ${danger ? "border-fascist" : "border-ink"}`}
    >
      <h2 id={id} className={`font-display text-3xl ${danger ? "text-fascist" : ""}`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A suspended account's statement of reasons: how long, why (the moderator's
 * reason), and how to appeal. The account stays signed in to read it; every
 * gate (tickets, quick match, room creation) refuses it meanwhile.
 */
async function SuspensionNotice({ ban, locale }: { ban: ActiveBan; locale: Locale }) {
  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: "profile" }),
    getFormatter({ locale }),
  ]);
  return (
    <section
      aria-labelledby="profile-suspension"
      className="space-y-3 rounded-lg border-2 border-fascist bg-paper-raised p-5 shadow-sm"
      data-testid="suspension-notice"
    >
      <h2 id="profile-suspension" className="font-display text-3xl text-fascist">
        {t("suspension.title")}
      </h2>
      <p className="text-lg font-semibold">
        {ban.expiresAt
          ? t("suspension.until", { date: format.dateTime(ban.expiresAt, DATE_TIME) })
          : t("suspension.permanent")}{" "}
        <span className="text-base font-normal text-ink-muted">
          {t("suspension.decided", { date: format.dateTime(ban.createdAt, DATE_ONLY) })}
        </span>
      </p>
      <div>
        <h3 className="font-display text-lg">{t("suspension.reasonLabel")}</h3>
        <blockquote className="border-l-4 border-rule pl-3 break-words whitespace-pre-line">
          {ban.reason}
        </blockquote>
      </div>
      <p>{t("suspension.effects")}</p>
      <p>
        {t.rich("suspension.appeal", {
          email: CONTACT_EMAIL,
          mail: (chunks) => (
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold break-all underline">
              {chunks}
            </a>
          ),
        })}
      </p>
      <p>
        <Link href="/conduite" className="underline">
          {t("suspension.conduct")}
        </Link>
      </p>
    </section>
  );
}

/** The signed-in player's own page: account, blocked players, game history, deletion. */
export default async function ProfilePage({ params, searchParams }: PageProps<"/[locale]/profil">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale, getPathname({ locale, href: "/profil" }));
  const before = parseBefore((await searchParams).before);

  const [t, format, blocked, page, ban] = await Promise.all([
    getTranslations({ locale, namespace: "profile" }),
    getFormatter({ locale }),
    listBlocked(prisma, user.id),
    userGameHistory(user.id, { limit: PAGE_SIZE + 1, before }),
    activeBan(prisma, user.id),
  ]);
  const games = page.slice(0, PAGE_SIZE);
  const last = games.at(-1);
  const olderBefore = page.length > PAGE_SIZE && last ? last.endedAt.toISOString() : null;
  const lockedUntil = nextRenameAt(user.displayNameChangedAt)?.toISOString() ?? null;
  const blockedIds = new Set(blocked.map((b) => b.userId));

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} switchHref="/profil" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
        <header>
          <h1 className="font-display text-5xl tracking-wide">{t("page.title")}</h1>
          <p className="mt-2 text-lg text-ink-muted">{t("page.lead")}</p>
        </header>

        {ban && <SuspensionNotice ban={ban} locale={locale} />}

        <Section id="profile-account" title={t("account.title")}>
          <dl className="space-y-4">
            <div>
              <dt className="font-display text-lg">{t("account.displayName")}</dt>
              <dd className="text-xl font-semibold break-words" data-testid="profile-display-name">
                {user.displayName}
              </dd>
            </div>
            <div>
              <dt className="font-display text-lg">{t("account.email")}</dt>
              <dd className="space-y-1">
                <p className="break-all">
                  {user.email}{" "}
                  <span className="text-sm text-ink-muted">({t("account.emailPrivate")})</span>
                </p>
                {user.emailVerified ? (
                  <p className="text-sm">✓ {t("account.verified")}</p>
                ) : emailVerificationShown(getEnv()) ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{t("account.unverified")}</p>
                    <ResendVerificationButton email={user.email} />
                  </div>
                ) : null}
              </dd>
            </div>
          </dl>
          <RenameForm currentName={user.displayName} lockedUntil={lockedUntil} />
        </Section>

        <Section id="profile-blocks" title={t("blocks.title")}>
          <p>{t("blocks.lead")}</p>
          {blocked.length === 0 ? (
            <p className="text-ink-muted">{t("blocks.empty")}</p>
          ) : (
            <ul
              className="divide-y divide-rule"
              aria-label={t("blocks.listLabel")}
              data-testid="blocked-list"
            >
              {blocked.map((player) => {
                const name = player.name ?? t("blocks.noName");
                return (
                  <li key={player.userId} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold break-words">{name}</span>{" "}
                      <span className="text-sm text-ink-muted">
                        {t("blocks.since", { date: format.dateTime(player.blockedAt, DATE_ONLY) })}
                      </span>
                    </span>
                    <UnblockButton userId={player.userId} name={name} />
                  </li>
                );
              })}
            </ul>
          )}
          <BlockByNameForm />
        </Section>

        <Section id="profile-history" title={t("history.title")}>
          <GameHistory games={games} meId={user.id} blockedIds={blockedIds} />
          {(before || olderBefore) && (
            <nav className="flex flex-wrap gap-3" aria-label={t("history.title")}>
              {before && (
                <Link href="/profil" className={buttonClass("quiet")}>
                  {t("history.newest")}
                </Link>
              )}
              {olderBefore && (
                <Link
                  href={{ pathname: "/profil", query: { before: olderBefore } }}
                  className={buttonClass("secondary")}
                >
                  {t("history.older")}
                </Link>
              )}
            </nav>
          )}
        </Section>

        <Section id="profile-delete" title={t("delete.title")} danger>
          <p>{t("delete.lead")}</p>
          <DeleteAccountForm hasPassword={user.hasPassword} displayName={user.displayName} />
        </Section>
      </main>
    </div>
  );
}
