import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ClientMessage, PlayerSlot, RoomView } from "@sh/protocol";

import { ChatPanel } from "@/components/room/ChatPanel";
import { Lobby } from "@/components/room/Lobby";
import { StaticRoomProvider } from "@/lib/room-client/store";
import { initialRoomState, type RoomClientState } from "@/lib/room-client/state";

import { renderWithIntl } from "./render";

const slot = (n: number, extra: Partial<PlayerSlot> = {}): PlayerSlot => ({
  pid: `p${n}`,
  name: `Player ${n}`,
  guest: true,
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

function setup(room: RoomView, youPid: string, state: Partial<RoomClientState> = {}) {
  const sent: ClientMessage[] = [];
  const onSend = vi.fn((message: ClientMessage) => {
    sent.push(message);
    return true;
  });
  const full: RoomClientState = {
    ...initialRoomState,
    status: "open",
    you: { pid: youPid, name: "x" },
    room,
    ...state,
  };
  renderWithIntl(
    <StaticRoomProvider state={full} onSend={onSend}>
      <Lobby room={room} youPid={youPid} />
    </StaticRoomProvider>,
  );
  return { sent };
}

describe("lobby", () => {
  it("keeps the start button disabled until 5 connected players are seated", async () => {
    setup(lobby([1, 2, 3, 4].map((n) => slot(n))), "p1");
    expect(screen.getByRole("button", { name: "Lancer la partie" })).toBeDisabled();
    expect(screen.getByText(/Encore 1 joueur assis/)).toBeInTheDocument();
  });

  it("waits for disconnected players, then lets the host start", async () => {
    const user = userEvent.setup();
    const { sent } = setup(lobby([slot(1), slot(2), slot(3), slot(4), slot(5)]), "p1");
    await user.click(screen.getByRole("button", { name: "Lancer la partie" }));
    expect(sent).toContainEqual({ t: "start" });
  });

  it("explains a disconnected seat", () => {
    setup(lobby([slot(1), slot(2), slot(3), slot(4), slot(5, { connected: false })]), "p1");
    expect(screen.getByRole("button", { name: "Lancer la partie" })).toBeDisabled();
    expect(screen.getByText(/tous les joueurs assis soient connectés/)).toBeInTheDocument();
  });

  it("shows guests the host's job, without host controls", () => {
    setup(lobby([1, 2, 3, 4, 5].map((n) => slot(n))), "p2");
    expect(screen.queryByRole("button", { name: "Lancer la partie" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retirer/ })).toBeNull();
    expect(screen.queryByLabelText("Minuteurs")).toBeNull();
    expect(screen.getByText("En attente de l'hôte pour lancer la partie.")).toBeInTheDocument();
  });

  it("lets the host change the timers and remove a player", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { sent } = setup(lobby([slot(1), slot(2)]), "p1");
    await user.selectOptions(screen.getByLabelText("Minuteurs"), "fast");
    expect(sent).toContainEqual({ t: "settings", timers: "fast" });
    await user.click(screen.getByRole("button", { name: "Retirer Player 2 de la salle" }));
    expect(sent).toContainEqual({ t: "kick", pid: "p2" });
  });

  it("lets a member stand up and sit down", async () => {
    const user = userEvent.setup();
    const { sent } = setup(lobby([slot(1), slot(2)]), "p2");
    await user.click(screen.getByRole("button", { name: "Juste regarder" }));
    expect(sent).toContainEqual({ t: "stand" });
  });
});

describe("chat panel", () => {
  it("translates system messages and sends what is typed", async () => {
    const user = userEvent.setup();
    const sent: ClientMessage[] = [];
    const room = lobby([slot(1)]);
    renderWithIntl(
      <StaticRoomProvider
        state={{
          ...initialRoomState,
          status: "open",
          you: { pid: "p1", name: "Player 1" },
          room,
          chat: [
            { kind: "system", id: 1, at: 1, key: "playerJoined", params: { name: "Ada" } },
            { kind: "player", id: 2, at: 2, pid: "p2", name: "Basile", text: "bonjour" },
          ],
        }}
        onSend={(message) => {
          sent.push(message);
          return true;
        }}
      >
        <ChatPanel />
      </StaticRoomProvider>,
    );
    const log = screen.getByRole("list");
    expect(within(log).getByText("Ada a rejoint la salle.")).toBeInTheDocument();
    expect(within(log).getByText("bonjour")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message"), "  salut  ");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(sent).toEqual([{ t: "chat", text: "salut" }]);
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });
});
