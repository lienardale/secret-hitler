/**
 * The room's player menu (mute, block, report), the report dialog, muted chat,
 * and the notices of M5: suspended account (4451), abandon cooldown, refused
 * offensive message, moderator system messages.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, PlayerSlot, RoomView } from "@sh/protocol";

import { ChatPanel } from "@/components/room/ChatPanel";
import { Lobby } from "@/components/room/Lobby";
import { RoomMembers } from "@/components/room/RoomMembers";
import { ClosedNotice, RefusalNotice } from "@/components/room/status";
import { StaticRoomProvider } from "@/lib/room-client/store";
import { initialRoomState, type RoomClientState } from "@/lib/room-client/state";

import enCommon from "../../messages/en/common.json";
import enGame from "../../messages/en/game.json";
import enRoom from "../../messages/en/room.json";
import frCommon from "../../messages/fr/common.json";
import frGame from "../../messages/fr/game.json";
import frRoom from "../../messages/fr/room.json";

const actions = vi.hoisted(() => ({
  blockFromRoomAction: vi.fn(),
  reportPlayerAction: vi.fn(),
}));
vi.mock("@/app/[locale]/salle/[code]/actions", () => actions);
// next-intl's navigation needs Next's router (Node cannot resolve `next/navigation` here):
// a plain anchor with the localized path stands in for its Link.
vi.mock("@/lib/i18n/navigation", async () => {
  const { useLocale } = await import("next-intl");
  const { routing } = await import("@/lib/i18n/routing");
  const paths = routing.pathnames as Record<string, string | Record<string, string>>;
  function Link({
    href,
    children,
    ...rest
  }: { href: string | { pathname: string }; children?: React.ReactNode } & Record<
    string,
    unknown
  >) {
    const locale = useLocale();
    const pathname = typeof href === "string" ? href : href.pathname;
    const entry = paths[pathname];
    const localized = typeof entry === "string" ? entry : (entry?.[locale] ?? pathname);
    return (
      <a href={`/${locale}${localized === "/" ? "" : localized}`} {...rest}>
        {children}
      </a>
    );
  }
  return { Link };
});

const MESSAGES = {
  fr: { common: frCommon, room: frRoom, game: frGame },
  en: { common: enCommon, room: enRoom, game: enGame },
};

const member = (n: number, extra: Partial<PlayerSlot> = {}): PlayerSlot => ({
  pid: `p${n}`,
  name: `Player ${n}`,
  guest: false,
  connected: true,
  afk: false,
  ...extra,
});

function lobby(players: PlayerSlot[], extra: Partial<RoomView> = {}): RoomView {
  return {
    code: "BCDFG",
    visibility: "private",
    lang: "fr",
    status: "lobby",
    settings: { timers: "off", minPlayers: 7 },
    hostPid: "p1",
    players,
    spectators: [],
    startsAt: null,
    game: null,
    result: null,
    ...extra,
  };
}

const say = (id: number, pid: string, text: string): ChatMessage => ({
  kind: "player",
  id,
  at: id,
  pid,
  name: `Player ${pid.slice(1)}`,
  text,
});

function stateFor(room: RoomView, youPid: string, chat: ChatMessage[] = []): RoomClientState {
  return { ...initialRoomState, status: "open", you: { pid: youPid, name: "x" }, room, chat };
}

/** Renders inside the intl provider and a static room; `rerender` keeps both. */
function setup(
  room: RoomView,
  youPid: string,
  {
    chat = [] as ChatMessage[],
    locale = "fr" as "fr" | "en",
    ui = "lobby" as "lobby" | "members",
  } = {},
) {
  const onReconnect = vi.fn();
  const body = (state: RoomClientState): ReactNode => (
    <StaticRoomProvider state={state} onReconnect={onReconnect}>
      {ui === "lobby" ? (
        <Lobby room={state.room as RoomView} youPid={youPid} />
      ) : (
        <RoomMembers room={state.room as RoomView} youPid={youPid} />
      )}
    </StaticRoomProvider>
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Paris">
      {children}
    </NextIntlClientProvider>
  );
  const result = render(body(stateFor(room, youPid, chat)), { wrapper });
  return {
    onReconnect,
    rerenderChat: (next: ChatMessage[]) => result.rerender(body(stateFor(room, youPid, next))),
  };
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  window.localStorage.clear();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string, locale = "fr") {
  await user.click(
    screen.getByRole("button", {
      name: locale === "fr" ? `Actions pour ${name}` : `Actions for ${name}`,
    }),
  );
  return screen.getByRole("dialog", { name: new RegExp(name) });
}

describe("player menu", () => {
  it("has no menu for yourself, one for every other player and spectator", () => {
    setup(lobby([member(1), member(2)], { spectators: [member(3)] }), "p1");
    expect(screen.queryByRole("button", { name: "Actions pour Player 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Actions pour Player 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions pour Player 3" })).toBeInTheDocument();
  });

  it("a guest only gets mute, even on an account", async () => {
    const user = userEvent.setup();
    setup(lobby([member(1, { guest: true }), member(2)]), "p1");
    const dialog = await openMenu(user, "Player 2");
    expect(
      within(dialog).getByRole("button", { name: "Masquer ses messages" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Bloquer/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Signaler/ })).toBeNull();
    expect(
      within(dialog).getByText("Bloquer et signaler un joueur demandent un compte."),
    ).toBeVisible();
  });

  it("an account only gets mute on a guest", async () => {
    const user = userEvent.setup();
    setup(lobby([member(1), member(2, { guest: true })]), "p1");
    const dialog = await openMenu(user, "Player 2");
    expect(
      within(dialog).getByRole("button", { name: "Masquer ses messages" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Bloquer|Signaler/ })).toBeNull();
    expect(
      within(dialog).getByText(/Les invités ne peuvent être ni bloqués ni signalés/),
    ).toBeVisible();
  });

  it("an account gets mute, block and report on another account (English)", async () => {
    const user = userEvent.setup();
    setup(lobby([member(1), member(2)]), "p1", { locale: "en" });
    const dialog = await openMenu(user, "Player 2", "en");
    expect(within(dialog).getByRole("heading", { name: "Player 2" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Mute their messages" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Block Player 2" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Report Player 2" })).toBeInTheDocument();
  });

  it("closes on Escape and gives the focus back to its button", async () => {
    const user = userEvent.setup();
    setup(lobby([member(1), member(2)]), "p1");
    await openMenu(user, "Player 2");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Actions pour Player 2" })).toHaveFocus();
  });

  it("is reachable during a game, for players and spectators", async () => {
    const user = userEvent.setup();
    const room = lobby([member(1), member(2)], {
      status: "playing",
      spectators: [member(3, { guest: true })],
      game: { number: 1, turn: 3, deadline: null },
    });
    setup(room, "p1", { ui: "members" });
    const section = screen.getByRole("region", { name: "Dans la salle" });
    expect(within(section).getAllByTestId("room-member")).toHaveLength(3);
    expect(within(section).queryByRole("button", { name: "Actions pour Player 1" })).toBeNull();
    const dialog = await openMenu(user, "Player 3");
    expect(within(dialog).queryByRole("button", { name: /Signaler/ })).toBeNull();
  });
});

describe("block from the room", () => {
  it("blocks, says what it does, and reconnects so the next ticket carries the block", async () => {
    const user = userEvent.setup();
    actions.blockFromRoomAction.mockResolvedValue({ ok: true, already: false });
    const { onReconnect } = setup(lobby([member(1), member(2)]), "p1");
    const dialog = await openMenu(user, "Player 2");
    await user.click(within(dialog).getByRole("button", { name: "Bloquer Player 2" }));
    expect(actions.blockFromRoomAction).toHaveBeenCalledWith("BCDFG", "p2");
    expect(
      await within(dialog).findByText(
        "Vous avez bloqué Player 2 : ses messages vous sont masqués et la partie rapide ne vous réunira plus.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "Ouvrir mon profil" })).toHaveAttribute(
      "href",
      "/fr/profil",
    );
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal and does not reconnect", async () => {
    const user = userEvent.setup();
    actions.blockFromRoomAction.mockResolvedValue({ ok: false, error: "unknown_target" });
    const { onReconnect } = setup(lobby([member(1), member(2)]), "p1");
    const dialog = await openMenu(user, "Player 2");
    await user.click(within(dialog).getByRole("button", { name: "Bloquer Player 2" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Ce joueur n'est plus dans la salle.",
    );
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

describe("report dialog", () => {
  it("asks for a reason, then sends the report and confirms", async () => {
    const user = userEvent.setup();
    actions.reportPlayerAction.mockResolvedValue({ ok: true });
    setup(lobby([member(1), member(2)]), "p1");
    const menu = await openMenu(user, "Player 2");
    await user.click(within(menu).getByRole("button", { name: "Signaler Player 2" }));

    const dialog = screen.getByRole("dialog", { name: "Signaler Player 2" });
    expect(within(dialog).getByRole("heading", { name: "Signaler Player 2" })).toHaveFocus();
    const reasons = within(dialog).getByRole("group", { name: "Motif" });
    expect(within(reasons).getAllByRole("radio")).toHaveLength(6);
    expect(within(dialog).getByText(/les 100 derniers messages de la discussion/)).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "Lire le code de conduite" })).toHaveAttribute(
      "href",
      "/fr/conduite",
    );

    await user.click(within(dialog).getByRole("button", { name: "Envoyer le signalement" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choisissez un motif.");
    expect(actions.reportPlayerAction).not.toHaveBeenCalled();

    await user.click(within(reasons).getByRole("radio", { name: "Harcèlement ou insultes" }));
    const details = within(dialog).getByRole("textbox", { name: "Précisions (facultatif)" });
    expect(details).toHaveAttribute("maxlength", "500");
    await user.type(details, "Insultes répétées dans la discussion");
    await user.click(within(dialog).getByRole("button", { name: "Envoyer le signalement" }));

    expect(actions.reportPlayerAction).toHaveBeenCalledWith(
      "BCDFG",
      "p2",
      "harassment",
      "Insultes répétées dans la discussion",
    );
    expect(
      await within(dialog).findByText("Signalement envoyé : les modérateurs vont l'examiner."),
    ).toBeVisible();
  });

  it("keeps what was typed when the report is refused", async () => {
    const user = userEvent.setup();
    actions.reportPlayerAction.mockResolvedValue({
      ok: false,
      error: "rate_limited",
      values: { reason: "spam", details: "flood" },
    });
    setup(lobby([member(1), member(2)]), "p1", { locale: "en" });
    const menu = await openMenu(user, "Player 2", "en");
    await user.click(within(menu).getByRole("button", { name: "Report Player 2" }));
    const dialog = screen.getByRole("dialog", { name: "Report Player 2" });
    await user.click(within(dialog).getByRole("radio", { name: "Spam or flooding" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Details (optional)" }), "flood");
    await user.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Too many requests in a short time. Try again in an hour.",
    );
    expect(within(dialog).getByRole("radio", { name: "Spam or flooding" })).toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "Details (optional)" })).toHaveValue(
      "flood",
    );
    expect(screen.queryByText("Report sent: moderators will look at it.")).toBeNull();
  });
});

describe("muted members", () => {
  it("hides their messages, history and live, until unmuted; the choice is kept per room", async () => {
    const user = userEvent.setup();
    const room = lobby([member(1), member(2), member(3)]);
    const history = [say(1, "p2", "message de deux"), say(2, "p3", "message de trois")];
    const { rerenderChat } = setup(room, "p1", { chat: history });
    const dialog = await openMenu(user, "Player 2");
    await user.click(within(dialog).getByRole("button", { name: "Masquer ses messages" }));
    expect(
      within(dialog).getByRole("button", { name: "Afficher ses messages" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Fermer" }));

    expect(screen.queryByText("message de deux")).toBeNull();
    expect(screen.getByText("message de trois")).toBeVisible();
    expect(screen.getByTestId("chat-hidden")).toHaveTextContent("1 message masqué");
    expect(screen.getAllByText("messages masqués")).toHaveLength(1); // next to Player 2
    expect(JSON.parse(window.localStorage.getItem("sh:muted:BCDFG") ?? "{}").pids).toEqual(["p2"]);

    // A live message from them stays hidden too.
    rerenderChat([...history, say(3, "p2", "encore deux")]);
    expect(screen.queryByText("encore deux")).toBeNull();
    expect(screen.getByTestId("chat-hidden")).toHaveTextContent("2 messages masqués");

    const again = await openMenu(user, "Player 2");
    await user.click(within(again).getByRole("button", { name: "Afficher ses messages" }));
    await user.click(within(again).getByRole("button", { name: "Fermer" }));
    expect(screen.getByText("message de deux")).toBeVisible();
    expect(screen.getByText("encore deux")).toBeVisible();
    expect(screen.queryByTestId("chat-hidden")).toBeNull();
    expect(window.localStorage.getItem("sh:muted:BCDFG")).toBeNull();
  });

  it("a mute stored for this room applies from the first render (the welcome's history)", () => {
    window.localStorage.setItem("sh:muted:BCDFG", JSON.stringify({ pids: ["p2"], at: Date.now() }));
    setup(lobby([member(1), member(2)]), "p1", {
      chat: [say(1, "p2", "caché"), say(2, "p1", "visible")],
    });
    expect(screen.queryByText("caché")).toBeNull();
    expect(screen.getByText("visible")).toBeVisible();
  });
});

describe("room notices", () => {
  function renderIntl(ui: ReactNode, locale: "fr" | "en" = "fr") {
    return render(
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Paris">
        {ui}
      </NextIntlClientProvider>,
    );
  }

  it("a suspended account (4451) is sent to its profile, with no reload button", () => {
    renderIntl(<ClosedNotice code={4451} />);
    expect(screen.getByText("Votre compte est suspendu par la modération.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Voir mon profil" })).toHaveAttribute(
      "href",
      "/fr/profil",
    );
    expect(screen.queryByRole("button", { name: "Recharger la page" })).toBeNull();
  });

  it("the abandon cooldown says when public games open again (English)", () => {
    const until = Date.parse("2026-11-02T11:45:00Z"); // 12:45 in Paris
    renderIntl(<ClosedNotice code={null} cooldown={{ until }} />, "en");
    expect(
      screen.getByText(
        /You left two public games within 24 hours: you can join a public game again at 12:45/,
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to public games" })).toHaveAttribute(
      "href",
      "/en/play",
    );
    expect(screen.queryByRole("button", { name: "Reload the page" })).toBeNull();
  });

  it("an offensive message refused by the room shows its notice", () => {
    renderIntl(<RefusalNotice error={{ code: "chat_offensive", at: 1 }} />);
    expect(
      screen.getByText("Message refusé : il contient un mot interdit (voir le code de conduite)."),
    ).toBeVisible();
  });

  it("renders the moderators' system messages with their names", () => {
    const room = lobby([member(1)]);
    render(
      <NextIntlClientProvider locale="fr" messages={MESSAGES.fr} timeZone="Europe/Paris">
        <StaticRoomProvider
          state={stateFor(room, "p1", [
            { kind: "system", id: 1, at: 1, key: "playerRemoved", params: { name: "Bob" } },
            {
              kind: "system",
              id: 2,
              at: 2,
              key: "playerRenamed",
              params: { old: "Grossier", name: "Player 12345" },
            },
          ])}
        >
          <ChatPanel />
        </StaticRoomProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Bob a été retiré de la salle par la modération.")).toBeVisible();
    expect(screen.getByText("Grossier s'appelle désormais Player 12345.")).toBeVisible();
  });
});
