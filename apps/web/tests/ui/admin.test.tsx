/**
 * Moderation pages: the evidence of a report (transcript with system messages
 * in the viewer's language and the reported player's lines marked, members,
 * public game log) and the moderator action forms (what they send, what they
 * show, what they keep after a refusal).
 */
import type { GameEvent } from "@sh/engine";
import type { ChatMessage } from "@sh/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EvidenceMember } from "@/components/admin/ReportEvidence";

import enAdmin from "../../messages/en/admin.json";
import enGame from "../../messages/en/game.json";
import enRoom from "../../messages/en/room.json";
import frAdmin from "../../messages/fr/admin.json";
import frGame from "../../messages/fr/game.json";
import frRoom from "../../messages/fr/room.json";

const actions = vi.hoisted(() => ({
  banAction: vi.fn(),
  banByNameAction: vi.fn(),
  unbanAction: vi.fn(),
  forceRenameAction: vi.fn(),
  dismissAction: vi.fn(),
  noteAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/actions", () => actions);
vi.mock("@/app/[locale]/(auth)/actions", () => ({}));

const { MembersList, PublicGameLog, Transcript, partyPid } =
  await import("@/components/admin/ReportEvidence");
const { BanByNameForm, BanForm, DismissForm, ForceRenameForm, NoteForm, UnbanButton } =
  await import("@/components/admin/AdminForms");

const MESSAGES = {
  fr: { admin: frAdmin, room: frRoom, game: frGame },
  en: { admin: enAdmin, room: enRoom, game: enGame },
};

function renderWithIntl(ui: ReactElement, locale: "fr" | "en" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Paris">
      {ui}
    </NextIntlClientProvider>,
  );
}

const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const REPORTER_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AT = Date.parse("2026-11-02T10:20:30Z");

const MEMBERS: EvidenceMember[] = [
  { pid: "p1", kind: "user", sub: REPORTER_ID, name: "Ada", seat: 0, host: true, connected: true },
  { pid: "p2", kind: "user", sub: TARGET_ID, name: "Bob", seat: 1, host: false, connected: true },
  {
    pid: "p3",
    kind: "guest",
    sub: "g-3",
    name: "Chloé",
    seat: null,
    host: false,
    connected: false,
  },
];

const CHAT: ChatMessage[] = [
  { kind: "system", id: 1, at: AT, key: "playerJoined", params: { name: "Bob" } },
  { kind: "player", id: 2, at: AT + 5_000, pid: "p2", name: "Bob", text: "you all suck" },
  { kind: "player", id: 3, at: AT + 9_000, pid: "p1", name: "Ada", text: "please stop" },
  { kind: "player", id: 4, at: AT + 12_000, pid: "p3", name: "Chloé", text: "lol" },
  {
    kind: "system",
    id: 5,
    at: AT + 20_000,
    key: "playerRenamed",
    params: { old: "Bob", name: "Player 12345" },
  },
];

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});

// --------------------------------------------------------------- evidence ----

describe("partyPid", () => {
  it("finds a party by account id, else by the name it had in the room", () => {
    expect(partyPid(MEMBERS, { id: TARGET_ID.toUpperCase(), nameAtReport: "whatever" })).toBe("p2");
    expect(partyPid(MEMBERS, { id: null, nameAtReport: "Ada" })).toBe("p1");
    expect(partyPid(MEMBERS, { id: null, nameAtReport: "Nobody" })).toBeNull();
  });
});

describe("transcript", () => {
  it("renders system messages through the room's keys and marks the reported player's lines", () => {
    renderWithIntl(<Transcript headingId="t" chat={CHAT} targetPid="p2" reporterPid="p1" />);
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    const lines = within(screen.getByTestId("transcript")).getAllByTestId("transcript-line");
    expect(lines).toHaveLength(5);

    expect(lines[0]).toHaveAttribute("data-kind", "system");
    expect(lines[0]).toHaveTextContent("11:20:30");
    expect(lines[0]).toHaveTextContent("Room message: Bob joined the room.");
    expect(lines[4]).toHaveTextContent("Bob is now called Player 12345.");

    // The reported player's line carries a word tag, not only a colour.
    expect(lines[1]).toHaveAttribute("data-target", "true");
    expect(lines[1]).toHaveTextContent("Bob Reported player you all suck");
    expect(lines[2]).not.toHaveAttribute("data-target");
    expect(within(lines[2] as HTMLElement).getByText("Reporter")).toBeInTheDocument();
    expect(lines[3]).toHaveTextContent("Chloé lol");
    expect(lines[3]).not.toHaveTextContent("Reported");
    expect(screen.getAllByText("Reported player")).toHaveLength(1);
  });

  it("in French, and when the chat was empty", () => {
    const { unmount } = renderWithIntl(
      <Transcript headingId="t" chat={CHAT.slice(0, 1)} targetPid={null} reporterPid={null} />,
      "fr",
    );
    expect(screen.getByTestId("transcript-line")).toHaveTextContent(
      "Message de la salle : Bob a rejoint la salle.",
    );
    unmount();
    renderWithIntl(<Transcript headingId="t" chat={[]} targetPid="p2" reporterPid="p1" />, "fr");
    expect(screen.getByRole("heading", { name: "Discussion" })).toBeInTheDocument();
    expect(screen.getByText("Aucun message.")).toBeInTheDocument();
    expect(screen.queryByTestId("transcript")).not.toBeInTheDocument();
  });
});

describe("members and game log", () => {
  it("lists seat, host, connection and account or guest for each member", () => {
    renderWithIntl(<MembersList headingId="m" members={MEMBERS} targetPid="p2" reporterPid="p1" />);
    const members = screen.getAllByTestId("member");
    expect(members[0]).toHaveTextContent("Ada");
    expect(members[0]).toHaveTextContent("Reporter");
    expect(members[0]).toHaveTextContent("Seat 1 · Host · Connected · Account");
    expect(members[1]).toHaveTextContent("Bob");
    expect(members[1]).toHaveTextContent("Reported player");
    expect(members[1]).toHaveTextContent("Seat 2 · Connected · Account");
    expect(members[2]).toHaveTextContent("No seat · Disconnected · Guest");
  });

  it("turns the public events into sentences with the players' names", () => {
    const events: GameEvent[] = [
      { type: "gameStarted", playerCount: 5, president: 0 },
      { type: "roundStarted", president: 0, special: false },
      { type: "chancellorNominated", president: 0, nominee: 1 },
      { type: "voteCast", seat: 0 },
      {
        type: "voteResult",
        president: 0,
        nominee: 1,
        votes: [true, true, false, true, null],
        passed: true,
      },
      { type: "policyEnacted", policy: "F", byChaos: false },
    ];
    renderWithIntl(
      <PublicGameLog
        headingId="g"
        events={events}
        members={MEMBERS}
        game={{ id: REPORT_ID, number: 3 }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Public game log" })).toBeInTheDocument();
    expect(screen.getByText(/^Game 3 ·/)).toBeInTheDocument();
    const log = screen.getByTestId("game-log");
    const items = within(log).getAllByRole("listitem");
    // voteCast has no line.
    expect(items.map((item) => item.textContent)).toEqual([
      "The game begins with 5 players.",
      "Ada is President.",
      "Ada nominates Bob for Chancellor.",
      expect.stringContaining("The vote passes (3 Ja!, 1 Nein!): Ada and Bob form the government."),
      "A Fascist policy is enacted.",
    ]);
    // Seats nobody holds in the members list fall back to "Seat n".
    expect(items[3]).toHaveTextContent("Ja!: Ada, Bob, and Seat 4 · Nein!: Seat 3");
  });

  it("says when there was no game", () => {
    renderWithIntl(<PublicGameLog headingId="g" events={[]} members={[]} game={null} />, "fr");
    expect(screen.getByText("Aucune partie dans la salle.")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ forms ----

describe("ban form", () => {
  it("sends the account, the report, the duration and the reason, then confirms", async () => {
    actions.banAction.mockResolvedValue({
      ok: true,
      notice: "banned",
      name: "Bob",
      expiresAt: Date.parse("2026-11-09T10:00:00Z"),
      live: { reached: true, count: 2 },
    });
    renderWithIntl(<BanForm userId={TARGET_ID} reportId={REPORT_ID} />);
    const form = screen.getByRole("form", { name: "Ban the player" });
    await userEvent.selectOptions(within(form).getByLabelText("Duration"), "7 days");
    await userEvent.type(within(form).getByLabelText("Reason (shown to the player)"), "Insults");
    await userEvent.type(within(form).getByLabelText("Internal note (optional)"), "first time");
    await userEvent.click(within(form).getByRole("button", { name: "Ban" }));

    await waitFor(() =>
      expect(within(form).getByRole("status")).toHaveTextContent(
        "The account Bob is banned until November 9, 2026",
      ),
    );
    expect(within(form).getByRole("status")).toHaveTextContent(
      "They were removed from 2 open rooms.",
    );
    const formData = actions.banAction.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(formData)).toEqual({
      userId: TARGET_ID,
      reportId: REPORT_ID,
      duration: "7d",
      reason: "Insults",
      note: "first time",
    });
    // A success clears the form.
    expect(within(form).getByLabelText("Reason (shown to the player)")).toHaveValue("");
    expect(within(form).getByLabelText("Duration")).toHaveValue("");
  });

  it("a refusal keeps what was typed, the duration included, and points at the field", async () => {
    actions.banAction.mockResolvedValue({
      ok: false,
      error: "reasonTooLong",
      values: { reason: "Way too long", note: "n", duration: "30d" },
    });
    renderWithIntl(<BanForm userId={TARGET_ID} />, "fr");
    const form = screen.getByRole("form", { name: "Bannir le joueur" });
    await userEvent.selectOptions(within(form).getByLabelText("Durée"), "30 jours");
    await userEvent.type(within(form).getByLabelText("Motif (montré au joueur)"), "Way too long");
    await userEvent.type(within(form).getByLabelText("Note interne (facultative)"), "n");
    await userEvent.click(within(form).getByRole("button", { name: "Bannir" }));

    await waitFor(() =>
      expect(within(form).getByRole("alert")).toHaveTextContent("Le motif dépasse 500 caractères."),
    );
    const reason = within(form).getByLabelText("Motif (montré au joueur)");
    expect(reason).toHaveValue("Way too long");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason.getAttribute("aria-describedby")).toBe(
      within(form).getByRole("alert").getAttribute("id"),
    );
    expect(within(form).getByLabelText("Durée")).toHaveValue("30d");
    expect(within(form).getByLabelText("Note interne (facultative)")).toHaveValue("n");
    expect((actions.banAction.mock.calls[0]?.[1] as FormData).get("reportId")).toBeNull();
  });

  it("says when the rooms server could not be reached", async () => {
    actions.banAction.mockResolvedValue({
      ok: true,
      notice: "banned",
      name: "Bob",
      expiresAt: null,
      live: { reached: false },
    });
    renderWithIntl(<BanForm userId={TARGET_ID} />);
    const form = screen.getByRole("form", { name: "Ban the player" });
    await userEvent.selectOptions(within(form).getByLabelText("Duration"), "Permanent");
    await userEvent.type(within(form).getByLabelText("Reason (shown to the player)"), "Hate");
    await userEvent.click(within(form).getByRole("button", { name: "Ban" }));
    await waitFor(() =>
      expect(within(form).getByRole("status")).toHaveTextContent(
        "The account Bob is banned permanently.",
      ),
    );
    expect(within(form).getByRole("status")).toHaveTextContent(
      "The rooms server did not answer: the ban is recorded",
    );
  });
});

describe("ban by display name", () => {
  it("keeps the name when no player has it", async () => {
    actions.banByNameAction.mockResolvedValue({
      ok: false,
      error: "playerNotFound",
      values: { name: "Nobody", reason: "Spam", duration: "1d", note: "" },
    });
    renderWithIntl(<BanByNameForm />);
    const form = screen.getByRole("form", { name: "Ban by display name" });
    await userEvent.type(within(form).getByLabelText("Player's display name"), "Nobody");
    await userEvent.selectOptions(within(form).getByLabelText("Duration"), "1 day");
    await userEvent.type(within(form).getByLabelText("Reason (shown to the player)"), "Spam");
    await userEvent.click(within(form).getByRole("button", { name: "Ban" }));
    await waitFor(() =>
      expect(within(form).getByRole("alert")).toHaveTextContent("No player has this display name."),
    );
    const name = within(form).getByLabelText("Player's display name");
    expect(name).toHaveValue("Nobody");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(within(form).getByLabelText("Duration")).toHaveValue("1d");
    expect((actions.banByNameAction.mock.calls[0]?.[1] as FormData).get("name")).toBe("Nobody");
  });
});

describe("rename, dismiss, note and unban", () => {
  it("force rename confirms the new name and the live rooms", async () => {
    actions.forceRenameAction.mockResolvedValue({
      ok: true,
      notice: "renamed",
      from: "Rude",
      to: "Player 12345",
      live: { reached: true, count: 1 },
    });
    renderWithIntl(<ForceRenameForm userId={TARGET_ID} reportId={REPORT_ID} />);
    const form = screen.getByRole("form", { name: "Force a rename" });
    await userEvent.click(within(form).getByRole("button", { name: "Force a rename" }));
    await waitFor(() =>
      expect(within(form).getByRole("status")).toHaveTextContent(
        "Rude is now called Player 12345.",
      ),
    );
    expect(within(form).getByText("The new name shows in one open room.")).toBeInTheDocument();
    const formData = actions.forceRenameAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("userId")).toBe(TARGET_ID);
    expect(formData.get("reportId")).toBe(REPORT_ID);
  });

  it("dismiss sends the report and its note (French)", async () => {
    actions.dismissAction.mockResolvedValue({
      ok: false,
      error: "reportClosed",
      values: { note: "ok" },
    });
    renderWithIntl(<DismissForm reportId={REPORT_ID} />, "fr");
    const form = screen.getByRole("form", { name: "Classer sans suite" });
    await userEvent.type(within(form).getByLabelText("Note interne (facultative)"), "ok");
    await userEvent.click(within(form).getByRole("button", { name: "Classer sans suite" }));
    await waitFor(() =>
      expect(within(form).getByRole("alert")).toHaveTextContent("Ce signalement est déjà fermé."),
    );
    expect(within(form).getByLabelText("Note interne (facultative)")).toHaveValue("ok");
    expect((actions.dismissAction.mock.calls[0]?.[1] as FormData).get("reportId")).toBe(REPORT_ID);
  });

  it("dismiss renders nothing once the report is closed elsewhere", () => {
    const { container } = renderWithIntl(<DismissForm reportId={REPORT_ID} closed />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a note is required and confirmed", async () => {
    actions.noteAction.mockResolvedValue({ ok: true, notice: "noted" });
    renderWithIntl(<NoteForm reportId={REPORT_ID} />);
    const form = screen.getByRole("form", { name: "Add a note" });
    const note = within(form).getByLabelText("Note");
    expect(note).toBeRequired();
    await userEvent.type(note, "Watch this player");
    await userEvent.click(within(form).getByRole("button", { name: "Add the note" }));
    await waitFor(() => expect(within(form).getByRole("status")).toHaveTextContent("Note added."));
    expect(note).toHaveValue("");
  });

  it("the unban button names the player", async () => {
    actions.unbanAction.mockResolvedValue({ ok: true, notice: "unbanned", name: "Bob" });
    renderWithIntl(<UnbanButton banId={REPORT_ID} name="Bob" />);
    await userEvent.click(screen.getByRole("button", { name: "Lift Bob's ban" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Bob's ban was lifted."),
    );
    expect((actions.unbanAction.mock.calls[0]?.[1] as FormData).get("banId")).toBe(REPORT_ID);
  });
});
