import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { LegalDate, LegalUpdated } from "@/components/site/LegalUpdated";
import { ContentPage, Section, SubHeading, TEXT_LINK } from "@/components/site/ContentPage";
import { CONTACT_EMAIL } from "@/lib/contact";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { GAME_COPYRIGHT, HOSTS, LICENSE_URL, PUBLISHER } from "@/lib/legal";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/mentions-legales">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "legal" });
  return { title: t("notice.meta.title"), description: t("notice.meta.description") };
}

/**
 * Legal notice (French LCEN art. 6-III): the publisher as configured in
 * lib/legal.ts (named, or anonymous non-professional), the publication
 * director, the hosts with their legal names and addresses, the contact
 * address, intellectual property and where to report content.
 */
export default async function LegalNoticePage({ params }: PageProps<"/[locale]/mentions-legales">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "legal" });
  const mail = (chunks: React.ReactNode) => (
    <a href={`mailto:${CONTACT_EMAIL}`} className={`${TEXT_LINK} break-all`}>
      {chunks}
    </a>
  );
  const identityHostId = PUBLISHER.kind === "anonymous" ? PUBLISHER.identityHost : null;
  const identityHost = HOSTS.find((host) => host.id === identityHostId);

  return (
    <ContentPage
      locale={locale}
      switchHref="/mentions-legales"
      title={t("notice.page.title")}
      lead={t("notice.page.lead")}
      aside={
        <LegalUpdated>
          {t.rich("updated", { date: () => <LegalDate locale={locale} /> })}
        </LegalUpdated>
      }
    >
      <Section id="publisher" title={t("notice.publisher.title")}>
        {PUBLISHER.kind === "anonymous" ? (
          <>
            <p>
              {t("notice.publisher.anonymous", {
                host: identityHost?.company ?? PUBLISHER.identityHost,
              })}
            </p>
            <p>{t("notice.publisher.directorAnonymous")}</p>
          </>
        ) : (
          <>
            <p>{t("notice.publisher.named", { name: PUBLISHER.name })}</p>
            <p>
              {t("notice.publisher.address")}{" "}
              <span className="whitespace-pre-line">{PUBLISHER.address.join("\n")}</span>
            </p>
            {PUBLISHER.phone && <p>{t("notice.publisher.phone", { phone: PUBLISHER.phone })}</p>}
            <p>{t("notice.publisher.director", { name: PUBLISHER.director })}</p>
          </>
        )}
        <p>{t.rich("notice.publisher.contact", { email: CONTACT_EMAIL, mail })}</p>
      </Section>

      <Section id="hosting" title={t("notice.hosts.title")}>
        <p>{t("notice.hosts.lead")}</p>
        {HOSTS.map((host) => (
          <div key={host.id} className="space-y-1">
            <SubHeading id={`host-${host.id}`}>
              {t("notice.hosts.heading", {
                service: host.service,
                role: t(`notice.hosts.role.${host.id}`),
              })}
            </SubHeading>
            {host.id === "neon" && <p>{t("notice.hosts.neonCompany")}</p>}
            <address className="not-italic">
              <span className="block font-semibold">{host.company}</span>
              {host.address.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              <span className="block">{t(`countries.${host.country}`)}</span>
              {host.phone && (
                <span className="block">{t("notice.hosts.phone", { phone: host.phone })}</span>
              )}
              <span className="block">
                {t.rich("notice.hosts.website", {
                  url: host.website.replace(/^https:\/\//, ""),
                  link: (chunks) => (
                    <a href={host.website} className={TEXT_LINK}>
                      {chunks}
                    </a>
                  ),
                })}
              </span>
            </address>
          </div>
        ))}
      </Section>

      <Section id="intellectual-property" title={t("notice.ip.title")}>
        <p>
          {t.rich("notice.ip.game", {
            copyright: GAME_COPYRIGHT,
            link: (chunks) => (
              <a href={LICENSE_URL} rel="license" className={TEXT_LINK}>
                {chunks}
              </a>
            ),
          })}
        </p>
        <p>
          {t.rich("notice.ip.ours", {
            credits: (chunks) => (
              <Link href="/credits" className={TEXT_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Section>

      <Section id="report" title={t("notice.report.title")}>
        <p>
          {t.rich("notice.report.text", {
            email: CONTACT_EMAIL,
            mail,
            conduct: (chunks) => (
              <Link href="/conduite" className={TEXT_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Section>

      <Section id="personal-data" title={t("notice.privacy.title")}>
        <p>
          {t.rich("notice.privacy.text", {
            link: (chunks) => (
              <Link href="/confidentialite" className={TEXT_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Section>
    </ContentPage>
  );
}
