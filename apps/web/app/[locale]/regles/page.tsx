import { MAX_PLAYERS, MIN_PLAYERS, POWER_BOARDS, ROLE_TABLE, type PlayerCount } from "@sh/engine";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ContentPage, Section, SubHeading, TEXT_LINK } from "@/components/site/ContentPage";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { RULES_PDF_URL } from "@/lib/legal";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/regles">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "rules" });
  return { title: t("meta.title"), description: t("meta.description") };
}

/** Section ids: the table of contents and links from other pages use them. */
const SECTIONS = [
  ["goal", "goal.title"],
  ["roles", "roles.title"],
  ["knowledge", "knowledge.title"],
  ["deck", "deck.title"],
  ["round", "round.title"],
  ["powers", "powers.title"],
  ["veto", "veto.title"],
  ["chaos", "chaos.title"],
  ["reshuffle", "reshuffle.title"],
  ["winning", "winning.title"],
  ["playing-here", "here.title"],
  ["faq", "faq.title"],
] as const;

const PLAYER_COUNTS = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => (MIN_PLAYERS + i) as PlayerCount,
);
/** Columns of the powers table, from the engine's boards. */
const BOARDS = [
  ["small", POWER_BOARDS.small],
  ["medium", POWER_BOARDS.medium],
  ["large", POWER_BOARDS.large],
] as const;
const POWERS = ["investigate", "peek", "specialElection", "execute"] as const;
const FAQ = [
  "hitlerKnows",
  "votes",
  "vetoChaos",
  "lying",
  "leaving",
  "termLimits",
  "investigation",
] as const;

const cell = "border border-rule px-2 py-2 sm:px-3";

/**
 * The rules in our own words, matching what the engine enforces
 * (packages/engine: ROLE_TABLE, POWER_BOARDS, eligibility, chaos, deck), with
 * a link to the official PDF, the site's own rules and a FAQ.
 */
export default async function RulesPage({ params }: PageProps<"/[locale]/regles">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "rules" });
  const b = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  return (
    <ContentPage
      locale={locale}
      switchHref="/regles"
      title={t("page.title")}
      lead={t("page.lead")}
      aside={
        <>
          <p className="rounded-md border-2 border-liberal bg-paper-raised px-4 py-3">
            {t.rich("page.official", {
              link: (chunks) => (
                <a href={RULES_PDF_URL} className={TEXT_LINK}>
                  {chunks}
                </a>
              ),
            })}
          </p>
          <nav aria-label={t("toc.label")}>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {SECTIONS.map(([id, key]) => (
                <li key={id}>
                  <a href={`#${id}`} className="underline underline-offset-4">
                    {t(key)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </>
      }
    >
      <Section id="goal" title={t("goal.title")}>
        <p>{t("goal.teams")}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t.rich("goal.liberals", { b })}</li>
          <li>{t.rich("goal.fascists", { b })}</li>
        </ul>
        <p>{t("goal.talk")}</p>
      </Section>

      <Section id="roles" title={t("roles.title")}>
        <p>{t("roles.lead")}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-center text-sm tabular-nums sm:text-base">
            <caption className="pb-2 text-left text-sm text-ink-muted">
              {t("roles.caption")}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={`${cell} text-left`}>
                  {t("roles.players")}
                </th>
                <th scope="col" className={cell}>
                  {t("roles.liberals")}
                </th>
                <th scope="col" className={cell}>
                  {t("roles.fascists")}
                </th>
                <th scope="col" className={cell}>
                  {t("roles.hitler")}
                </th>
              </tr>
            </thead>
            <tbody>
              {PLAYER_COUNTS.map((n) => (
                <tr key={n}>
                  <th scope="row" className={`${cell} text-left`}>
                    {n}
                  </th>
                  <td className={cell}>{ROLE_TABLE[n].liberal}</td>
                  <td className={cell}>{ROLE_TABLE[n].fascist}</td>
                  <td className={cell}>1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="knowledge" title={t("knowledge.title")}>
        <p>{t("knowledge.lead")}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t("knowledge.liberals")}</li>
          <li>{t("knowledge.fascists")}</li>
          <li>{t("knowledge.hitler")}</li>
        </ul>
        <p>{t("knowledge.here")}</p>
      </Section>

      <Section id="deck" title={t("deck.title")}>
        <p>{t("deck.text")}</p>
        <p>{t("deck.boards")}</p>
      </Section>

      <Section id="round" title={t("round.title")}>
        <SubHeading>{t("round.nomination.title")}</SubHeading>
        <p>{t("round.nomination.text")}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t("round.nomination.chancellor")}</li>
          <li>{t("round.nomination.president")}</li>
        </ul>
        <p>{t("round.nomination.note")}</p>
        <SubHeading>{t("round.vote.title")}</SubHeading>
        <p>{t("round.vote.text")}</p>
        <p>{t("round.vote.majority")}</p>
        <p>{t("round.vote.hitler")}</p>
        <SubHeading>{t("round.session.title")}</SubHeading>
        <p>{t("round.session.text")}</p>
        <p>{t("round.session.silence")}</p>
        <SubHeading>{t("round.power.title")}</SubHeading>
        <p>{t("round.power.text")}</p>
      </Section>

      <Section id="powers" title={t("powers.title")}>
        <p>{t("powers.lead")}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm sm:text-base">
            <caption className="pb-2 text-sm text-ink-muted">{t("powers.caption")}</caption>
            <thead>
              <tr>
                <th scope="col" className={cell}>
                  {t("powers.policy")}
                </th>
                {BOARDS.map(([size]) => (
                  <th key={size} scope="col" className={cell}>
                    {t(`powers.${size}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((slot) => (
                <tr key={slot}>
                  <th scope="row" className={`${cell} whitespace-nowrap`}>
                    {t("powers.ordinal", { n: slot + 1 })}
                  </th>
                  {BOARDS.map(([size, board]) => {
                    const power = board[slot];
                    return (
                      <td key={size} className={cell}>
                        {power ? t(`powers.names.${power}`) : t("powers.none")}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" className={`${cell} whitespace-nowrap`}>
                  {t("powers.ordinal", { n: 6 })}
                </th>
                <td colSpan={BOARDS.length} className={`${cell} font-semibold text-fascist`}>
                  {t("powers.win")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-2 pl-5">
          {POWERS.map((power) => (
            <li key={power}>{t.rich(`powers.describe.${power}`, { b })}</li>
          ))}
        </ul>
      </Section>

      <Section id="veto" title={t("veto.title")}>
        <p>{t("veto.text")}</p>
      </Section>

      <Section id="chaos" title={t("chaos.title")}>
        <p>{t("chaos.text")}</p>
        <p>{t("chaos.lead")}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t("chaos.power")}</li>
          <li>{t("chaos.hitler")}</li>
          <li>{t("chaos.terms")}</li>
          <li>{t("chaos.reset")}</li>
        </ul>
        <p>{t("chaos.still")}</p>
      </Section>

      <Section id="reshuffle" title={t("reshuffle.title")}>
        <p>{t("reshuffle.text")}</p>
      </Section>

      <Section id="winning" title={t("winning.title")}>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t.rich("winning.liberals", { b })}</li>
          <li>{t.rich("winning.fascists", { b })}</li>
        </ul>
        <p>{t("winning.reveal")}</p>
      </Section>

      <Section id="playing-here" title={t("here.title")}>
        <p>{t("here.chat")}</p>
        <p>{t("here.timers")}</p>
        <p>{t("here.away")}</p>
        <p>
          {t.rich("here.more", {
            link: (chunks) => (
              <Link href={{ pathname: "/credits", hash: "what-we-changed" }} className={TEXT_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Section>

      <Section id="faq" title={t("faq.title")}>
        {FAQ.map((key) => (
          <div key={key} className="space-y-2">
            <SubHeading id={`faq-${key}`}>{t(`faq.${key}.q`)}</SubHeading>
            {key === "vetoChaos" ? (
              <>
                <p>{t("faq.vetoChaos.a1")}</p>
                <p>{t("faq.vetoChaos.a2")}</p>
              </>
            ) : key === "lying" ? (
              <>
                <p>{t("faq.lying.a1")}</p>
                <p>
                  {t.rich("faq.lying.a2", {
                    link: (chunks) => (
                      <Link href="/conduite" className={TEXT_LINK}>
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              </>
            ) : key === "leaving" ? (
              <>
                <p>{t.rich("faq.leaving.public", { b })}</p>
                <p>{t.rich("faq.leaving.private", { b })}</p>
              </>
            ) : (
              <p>{t(`faq.${key}.a`)}</p>
            )}
          </div>
        ))}
      </Section>
    </ContentPage>
  );
}
