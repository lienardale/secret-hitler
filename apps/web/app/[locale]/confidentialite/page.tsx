import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ContentPage, Section, SubHeading, TEXT_LINK } from "@/components/site/ContentPage";
import { LegalDate, LegalUpdated } from "@/components/site/LegalUpdated";
import { CONTACT_EMAIL } from "@/lib/contact";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { PUBLISHER } from "@/lib/legal";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/confidentialite">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "legal" });
  return { title: t("privacy.meta.title"), description: t("privacy.meta.description") };
}

const SUMMARY = ["minimum", "noTracking", "chat", "delete", "age"] as const;
const ACCOUNT = ["email", "password", "name", "age", "other"] as const;
const RETENTION = [
  "guest",
  "account",
  "games",
  "chat",
  "reports",
  "moderation",
  "bans",
  "blocks",
  "visits",
  "limits",
  "links",
  "mutes",
] as const;
const COOKIES = ["guest", "session", "signIn", "google", "locale", "mute"] as const;

const CNIL_COMPLAINTS = "https://www.cnil.fr/fr/plaintes";
const cell = "border border-rule px-2 py-2 align-top sm:px-3";

/**
 * Privacy policy, written from what the code does (Prisma schema, cookies,
 * rate limits, the rooms Worker's storage and purge). Retention says "no time
 * limit for now" wherever the code enforces none.
 */
export default async function PrivacyPage({ params }: PageProps<"/[locale]/confidentialite">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "legal" });
  const b = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const mail = (chunks: React.ReactNode) => (
    <a href={`mailto:${CONTACT_EMAIL}`} className={`${TEXT_LINK} break-all`}>
      {chunks}
    </a>
  );
  const notice = (chunks: React.ReactNode) => (
    <Link href="/mentions-legales" className={TEXT_LINK}>
      {chunks}
    </Link>
  );

  return (
    <ContentPage
      locale={locale}
      switchHref="/confidentialite"
      title={t("privacy.page.title")}
      lead={t("privacy.page.lead")}
      aside={
        <LegalUpdated>
          {t.rich("updated", { date: () => <LegalDate locale={locale} /> })}
        </LegalUpdated>
      }
    >
      <Section id="summary" title={t("privacy.summary.title")}>
        <ul className="list-disc space-y-2 pl-5">
          {SUMMARY.map((key) => (
            <li key={key}>{t(`privacy.summary.${key}`)}</li>
          ))}
        </ul>
      </Section>

      <Section id="controller" title={t("privacy.controller.title")}>
        <p>
          {PUBLISHER.kind === "anonymous"
            ? t.rich("privacy.controller.anonymous", { email: CONTACT_EMAIL, mail, link: notice })
            : t.rich("privacy.controller.named", {
                name: PUBLISHER.name,
                email: CONTACT_EMAIL,
                mail,
                link: notice,
              })}
        </p>
      </Section>

      <Section id="data" title={t("privacy.data.title")}>
        <SubHeading id="data-guest">{t("privacy.data.guest.title")}</SubHeading>
        <p>{t("privacy.data.guest.text")}</p>

        <SubHeading id="data-account">{t("privacy.data.account.title")}</SubHeading>
        <p>{t("privacy.data.account.lead")}</p>
        <ul className="list-disc space-y-2 pl-5">
          {ACCOUNT.map((key) => (
            <li key={key}>{t(`privacy.data.account.${key}`)}</li>
          ))}
        </ul>
        <p>{t("privacy.data.account.google")}</p>

        <SubHeading id="data-games">{t("privacy.data.games.title")}</SubHeading>
        <p>{t("privacy.data.games.text")}</p>
        <p>{t("privacy.data.games.log")}</p>

        <SubHeading id="data-blocks">{t("privacy.data.blocks.title")}</SubHeading>
        <p>{t("privacy.data.blocks.text")}</p>

        <SubHeading id="data-chat">{t("privacy.data.chat.title")}</SubHeading>
        <p>{t("privacy.data.chat.text")}</p>
        <p>{t("privacy.data.chat.lobby")}</p>

        <SubHeading id="data-reports">{t("privacy.data.reports.title")}</SubHeading>
        <p>{t("privacy.data.reports.text")}</p>
        <p>{t("privacy.data.reports.actions")}</p>

        <SubHeading id="data-visits">{t("privacy.data.visits.title")}</SubHeading>
        <p>{t("privacy.data.visits.text")}</p>

        <SubHeading id="data-security">{t("privacy.data.security.title")}</SubHeading>
        <p>{t("privacy.data.security.text")}</p>

        <SubHeading id="data-technical">{t("privacy.data.technical.title")}</SubHeading>
        <p>{t("privacy.data.technical.text")}</p>

        <SubHeading id="data-mail">{t("privacy.data.mail.title")}</SubHeading>
        <p>{t("privacy.data.mail.text")}</p>

        <p className="font-semibold">{t("privacy.data.sharing")}</p>
      </Section>

      <Section id="legal-bases" title={t("privacy.bases.title")}>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t.rich("privacy.bases.service", { b })}</li>
          <li>{t.rich("privacy.bases.safety", { b })}</li>
        </ul>
        <p>{t("privacy.bases.consent")}</p>
      </Section>

      <Section id="hosting" title={t("privacy.hosting.title")}>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t.rich("privacy.hosting.vercel", { b })}</li>
          <li>{t.rich("privacy.hosting.neon", { b })}</li>
          <li>{t.rich("privacy.hosting.cloudflare", { b })}</li>
        </ul>
        <p>{t.rich("privacy.hosting.us", { link: notice })}</p>
      </Section>

      <Section id="retention" title={t("privacy.retention.title")}>
        <p>{t("privacy.retention.lead")}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm sm:text-base">
            <caption className="pb-2 text-sm text-ink-muted">
              {t("privacy.retention.caption")}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={cell}>
                  {t("privacy.retention.what")}
                </th>
                <th scope="col" className={cell}>
                  {t("privacy.retention.howLong")}
                </th>
              </tr>
            </thead>
            <tbody>
              {RETENTION.map((key) => (
                <tr key={key}>
                  <th scope="row" className={`${cell} font-semibold`}>
                    {t(`privacy.retention.rows.${key}.what`)}
                  </th>
                  <td className={cell}>{t(`privacy.retention.rows.${key}.howLong`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="cookies" title={t("privacy.cookies.title")}>
        <p>{t("privacy.cookies.lead")}</p>
        {/* A list, not a table: long cookie names make a three-column table unreadable on a phone. */}
        <ul className="space-y-3">
          {COOKIES.map((key) => (
            <li key={key} className="space-y-1 rounded-md border border-rule px-4 py-3">
              <p className="flex flex-col font-mono text-sm break-words">
                {t(`privacy.cookies.rows.${key}.name`)
                  .split(", ")
                  .map((name) => (
                    <code key={name}>{name}</code>
                  ))}
              </p>
              <p>{t(`privacy.cookies.rows.${key}.purpose`)}</p>
              <p className="text-ink-muted">
                {t("privacy.cookies.kept", {
                  duration: t(`privacy.cookies.rows.${key}.duration`),
                })}
              </p>
            </li>
          ))}
        </ul>
        <p>{t("privacy.cookies.prefix")}</p>
        <p>{t("privacy.cookies.fonts")}</p>
        <p>{t("privacy.cookies.worker")}</p>
      </Section>

      <Section id="rights" title={t("privacy.rights.title")}>
        <p>{t("privacy.rights.lead")}</p>
        <p>
          {t.rich("privacy.rights.profile", {
            link: (chunks) => (
              <Link href="/profil" className={TEXT_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </p>
        <p>{t("privacy.rights.deletion")}</p>
        <p>{t.rich("privacy.rights.ask", { email: CONTACT_EMAIL, mail })}</p>
        <p>
          {t.rich("privacy.rights.cnil", {
            link: (chunks) => (
              <a href={CNIL_COMPLAINTS} className={TEXT_LINK}>
                {chunks}
              </a>
            ),
          })}
        </p>
      </Section>

      <Section id="age" title={t("privacy.age.title")}>
        <p>{t("privacy.age.text")}</p>
      </Section>

      <Section id="changes" title={t("privacy.changes.title")}>
        <p>{t("privacy.changes.text")}</p>
      </Section>
    </ContentPage>
  );
}
