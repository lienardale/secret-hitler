/** Profile page pieces: the game history entries and the block / delete forms. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryGame } from "@/lib/games/history";

import enAuth from "../../messages/en/auth.json";
import enProfile from "../../messages/en/profile.json";
import frAuth from "../../messages/fr/auth.json";
import frProfile from "../../messages/fr/profile.json";

const actions = vi.hoisted(() => ({
  renameAction: vi.fn(),
  blockByNameAction: vi.fn(),
  blockPlayerAction: vi.fn(),
  unblockAction: vi.fn(),
  deleteAccountAction: vi.fn(),
}));
vi.mock("@/app/[locale]/profil/actions", () => actions);
vi.mock("@/app/[locale]/(auth)/actions", () => ({}));

const { GameHistory } = await import("@/components/profile/GameHistory");
const { BlockByNameForm, DeleteAccountForm } = await import("@/components/profile/ProfileForms");

const MESSAGES = {
  fr: { auth: frAuth, profile: frProfile },
  en: { auth: enAuth, profile: enProfile },
};

function renderWithIntl(ui: ReactElement, locale: "fr" | "en" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Paris">
      {ui}
    </NextIntlClientProvider>,
  );
}

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";

function game(extra: Partial<HistoryGame> = {}): HistoryGame {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    room: "BCDFG",
    visibility: "public",
    number: 1,
    endedAt: new Date("2026-11-02T10:20:00Z"),
    outcome: "finished",
    winner: "liberal",
    reason: "hitlerExecuted",
    you: { seat: 0, role: "liberal", won: true, left: false, alive: true },
    others: [
      { seat: 1, name: "Bob", role: "fascist", won: false, userId: BOB },
      { seat: 2, name: "Carol", role: "liberal", won: true, userId: CAROL },
      { seat: 3, name: null, role: "hitler", won: false, userId: null },
      { seat: 4, name: "Guest 4", role: "liberal", won: true, userId: null },
    ],
    ...extra,
  };
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});

describe("game history", () => {
  it("one entry per game, with the result, your role and the other players", () => {
    renderWithIntl(<GameHistory games={[game()]} meId={ME} blockedIds={new Set([CAROL])} />);
    const entries = screen.getAllByTestId("history-game");
    expect(entries).toHaveLength(1);
    const entry = entries[0] as HTMLElement;
    expect(entry).toHaveAttribute("data-game-id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(within(entry).getByRole("heading", { name: /Liberals won/ })).toHaveTextContent(
      "Liberals won · Hitler executed",
    );
    expect(entry).toHaveTextContent("Public game · Room BCDFG");
    expect(entry).toHaveTextContent("Your role: Liberal");
    expect(entry).toHaveTextContent("Won");
    expect(within(entry).getByText("Deleted player")).toBeInTheDocument();
    expect(entry).toHaveTextContent("Guest 4 (guest)");
    // Bob can be blocked; Carol already is; guests and deleted players cannot.
    expect(within(entry).getByRole("button", { name: "Block Bob" })).toBeInTheDocument();
    expect(within(entry).queryByRole("button", { name: "Block Carol" })).not.toBeInTheDocument();
    expect(within(entry).getByText("Blocked")).toBeInTheDocument();
    expect(within(entry).getAllByRole("button")).toHaveLength(1);
  });

  it("abandoned games, leaving, and the empty state", () => {
    const { unmount } = renderWithIntl(
      <GameHistory
        games={[
          game({
            outcome: "abandoned",
            winner: null,
            reason: null,
            visibility: "private",
            number: 3,
            you: { seat: 0, role: "hitler", won: false, left: true, alive: false },
          }),
        ]}
        meId={ME}
        blockedIds={new Set()}
      />,
      "fr",
    );
    const entry = screen.getByTestId("history-game");
    expect(entry).toHaveTextContent("Partie abandonnée");
    expect(entry).toHaveTextContent("Partie privée · Salle BCDFG · partie n° 3");
    expect(entry).toHaveTextContent("Votre rôle : Hitler (exécuté)");
    expect(entry).toHaveTextContent("Sans résultat");
    expect(entry).toHaveTextContent("Vous aviez quitté la partie.");
    unmount();

    renderWithIntl(<GameHistory games={[]} meId={ME} blockedIds={new Set()} />);
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
    expect(screen.getByText(/No games yet/)).toBeInTheDocument();
  });
});

describe("block by name", () => {
  it("sends the typed name, then clears it and confirms", async () => {
    actions.blockByNameAction.mockResolvedValue({ ok: true, notice: "blocked", name: "Élise" });
    renderWithIntl(<BlockByNameForm />);
    const form = screen.getByTestId("block-by-name-form");
    const input = within(form).getByLabelText("Player name");
    await userEvent.type(input, "elise");
    await userEvent.click(within(form).getByRole("button", { name: "Block" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Blocked: Élise."));
    const formData = actions.blockByNameAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("name")).toBe("elise");
    expect(input).toHaveValue("");
  });

  it("shows why it failed and keeps the name", async () => {
    actions.blockByNameAction.mockResolvedValue({ ok: false, error: "playerNotFound" });
    renderWithIntl(<BlockByNameForm />);
    const input = screen.getByLabelText("Player name");
    await userEvent.type(input, "Nobody");
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No player has this name."),
    );
    expect(input).toHaveValue("Nobody");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});

describe("delete my account", () => {
  it("opens in two steps and asks for the password", async () => {
    actions.deleteAccountAction.mockResolvedValue({ ok: false, error: "wrongPassword" });
    renderWithIntl(<DeleteAccountForm hasPassword displayName="Ada" />);
    expect(screen.queryByTestId("delete-account-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete my account…" }));

    const form = screen.getByTestId("delete-account-form");
    const password = within(form).getByLabelText("Your password");
    expect(password).toHaveFocus();
    await userEvent.type(password, "nope");
    await userEvent.click(within(form).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Wrong password."));
    const formData = actions.deleteAccountAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("password")).toBe("nope");
    expect(formData.get("locale")).toBe("en");

    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("delete-account-form")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete my account…" })).toHaveFocus();
  });

  it("an account without a password types its display name", async () => {
    renderWithIntl(<DeleteAccountForm hasPassword={false} displayName="Émilie" />, "fr");
    await userEvent.click(screen.getByRole("button", { name: "Supprimer mon compte…" }));
    const form = screen.getByTestId("delete-account-form");
    expect(within(form).queryByLabelText("Votre mot de passe")).not.toBeInTheDocument();
    const input = within(form).getByLabelText("Tapez votre nom de joueur pour confirmer : Émilie");
    expect(input).toHaveAttribute("name", "confirmName");
  });
});
