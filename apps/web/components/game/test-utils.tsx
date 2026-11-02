/**
 * Test helpers for the game components (imported by *.test.tsx only):
 * render with the real FR/EN catalogues and build `GameTable` props from an
 * engine fixture, the same way the room would.
 */
import { eventsFor, viewFor, type Action, type Viewer } from "@sh/engine";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { vi, type Mock } from "vitest";

import { buildFixture, fakePlayers, type Fixture, type FixtureName } from "@/lib/game-fixtures";
import enGame from "@/messages/en/game.json";
import frGame from "@/messages/fr/game.json";

import type { GameTableProps } from "./GameTable";

export type Locale = "en" | "fr";

export function WithIntl({
  locale = "en",
  children,
}: {
  locale?: Locale;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="Europe/Paris"
      messages={{ game: locale === "en" ? enGame : frGame } as never}
    >
      {children}
    </NextIntlClientProvider>
  );
}

export function renderIntl(ui: React.ReactElement, locale: Locale = "en") {
  const result = render(<WithIntl locale={locale}>{ui}</WithIntl>);
  return {
    ...result,
    rerenderIntl: (next: React.ReactElement) =>
      result.rerender(<WithIntl locale={locale}>{next}</WithIntl>),
  };
}

export type TestProps = GameTableProps & { onAction: Mock<(action: Action) => void> };

/** Props for `fixture` seen by `viewer` ("focus" = the fixture's acting seat, or seat 0). */
export function fixtureProps(
  fixture: Fixture | FixtureName,
  viewer: Viewer | "focus" = "focus",
  overrides: Partial<Omit<GameTableProps, "onAction">> = {},
): TestProps & { fixture: Fixture; viewer: Viewer } {
  const f = typeof fixture === "string" ? buildFixture(fixture, { players: 7, seed: 3 }) : fixture;
  const seat: Viewer = viewer === "focus" ? (f.focusSeat ?? 0) : viewer;
  return {
    fixture: f,
    viewer: seat,
    view: viewFor(f.game.state, seat),
    log: eventsFor(f.game.events, seat),
    players: fakePlayers(f.playerCount, { offline: f.offline, afk: f.afk }),
    turn: 1,
    deadline: null,
    clockOffset: 0,
    pending: false,
    onAction: vi.fn<(action: Action) => void>(),
    ...overrides,
  };
}
