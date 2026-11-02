import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { testPagesEnabled } from "@/lib/env";
import { isFixtureName } from "@/lib/game-fixtures";
import { routing } from "@/lib/i18n/routing";

import { TableSandbox, type SandboxConfig } from "./TableSandbox";

export const metadata: Metadata = {
  title: "Table sandbox",
  robots: { index: false, follow: false },
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?players=7&seed=3&fixture=<name>&seat=<n|spectator>` */
function parseConfig(query: Record<string, string | string[] | undefined>): SandboxConfig {
  const players = Number.parseInt(one(query.players) ?? "", 10);
  const seed = Number.parseInt(one(query.seed) ?? "", 10);
  const fixture = one(query.fixture);
  const seat = one(query.seat);
  let viewer: SandboxConfig["viewer"] = null;
  if (seat === "spectator") viewer = "spectator";
  else if (seat !== undefined && /^\d+$/.test(seat)) viewer = Number.parseInt(seat, 10);
  return {
    players: players >= 5 && players <= 10 ? players : 7,
    seed: Number.isFinite(seed) ? seed : 1,
    fixture: isFixtureName(fixture) ? fixture : "start",
    viewer,
  };
}

/**
 * Test page (404 unless ENABLE_TEST_PAGES=1): the game table driven by the
 * rules engine running in the browser, with fixtures and random play.
 */
export default async function DevTablePage(props: PageProps<"/[locale]/dev/table">) {
  if (!testPagesEnabled()) notFound();
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const config = parseConfig(await props.searchParams);
  return <TableSandbox initial={config} />;
}
