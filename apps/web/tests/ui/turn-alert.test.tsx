/**
 * Turn alerts (lib/turn-alert, components/room/TurnAlerts.tsx): the tab-title
 * prefix while a decision is open, one vibration per decision, and the
 * per-browser switch to turn vibration off.
 */
import { pendingActors, viewFor, type PlayerView, type Seat } from "@sh/engine";
import type { PlayerSlot, RoomView } from "@sh/protocol";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnAlerts } from "@/components/room/TurnAlerts";
import { buildFixture, fakePlayers, play, type LocalGame } from "@/lib/game-fixtures";
import { StaticRoomProvider } from "@/lib/room-client/store";
import { initialRoomState, type RoomClientState } from "@/lib/room-client/state";
import {
  createTurnAlert,
  loadVibrationPreference,
  prefixedTitle,
  saveVibrationPreference,
  unprefixedTitle,
  VIBRATION_PATTERN,
  VIBRATION_PREFERENCE_KEY,
  type AlertNavigator,
} from "@/lib/turn-alert/turn-alert";

import enRoom from "../../messages/en/room.json";
import frRoom from "../../messages/fr/room.json";

const BASE = "Salle BCDFG · Secret Hitler";
const FR = "● À vous";

function fakeNavigator(active = true) {
  const vibrate = vi.fn<(pattern: number | number[]) => boolean>(() => true);
  const nav: AlertNavigator = { vibrate, userActivation: { hasBeenActive: active } };
  return { nav, vibrate };
}

describe("turn alert (pure)", () => {
  it("adds the prefix once and removes it when the decision ends", () => {
    const doc = { title: BASE };
    const { nav } = fakeNavigator();
    const alert = createTurnAlert({ document: doc, navigator: nav });

    alert.update("3:vote", { prefix: FR, vibrate: true });
    expect(doc.title).toBe(`${FR} · ${BASE}`);
    alert.update("3:vote", { prefix: FR, vibrate: true });
    alert.update("4:presidentDiscard", { prefix: FR, vibrate: true });
    expect(doc.title).toBe(`${FR} · ${BASE}`);

    alert.update(null, { prefix: FR, vibrate: true });
    expect(doc.title).toBe(BASE);
  });

  it("vibrates once per decision, not for other players' votes", () => {
    const doc = { title: BASE };
    const { nav, vibrate } = fakeNavigator();
    const alert = createTurnAlert({ document: doc, navigator: nav });

    alert.update("3:vote", { prefix: FR, vibrate: true });
    // Others vote: same turn, same key.
    alert.update("3:vote", { prefix: FR, vibrate: true });
    alert.update("3:vote", { prefix: FR, vibrate: true });
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([...VIBRATION_PATTERN]);

    alert.update(null, { prefix: FR, vibrate: true });
    alert.update("5:nominate", { prefix: FR, vibrate: true });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("respects the preference and needs a past user gesture", () => {
    const off = fakeNavigator();
    const alertOff = createTurnAlert({ document: { title: BASE }, navigator: off.nav });
    alertOff.update("1:vote", { prefix: FR, vibrate: false });
    // Turning it back on mid-decision does not buzz for a decision already announced.
    alertOff.update("1:vote", { prefix: FR, vibrate: true });
    expect(off.vibrate).not.toHaveBeenCalled();

    const idle = fakeNavigator(false);
    createTurnAlert({ document: { title: BASE }, navigator: idle.nav }).update("1:vote", {
      prefix: FR,
      vibrate: true,
    });
    expect(idle.vibrate).not.toHaveBeenCalled();

    // No vibration API (iOS Safari): only the title.
    const doc = { title: BASE };
    createTurnAlert({ document: doc, navigator: {} }).update("1:vote", {
      prefix: FR,
      vibrate: true,
    });
    expect(doc.title).toBe(`${FR} · ${BASE}`);
  });

  it("restores the title on release and does not buzz again after a remount", () => {
    const doc = { title: BASE };
    const { nav, vibrate } = fakeNavigator();
    const alert = createTurnAlert({ document: doc, navigator: nav });
    alert.update("2:nominate", { prefix: FR, vibrate: true });
    alert.release();
    expect(doc.title).toBe(BASE);
    alert.update("2:nominate", { prefix: FR, vibrate: true });
    expect(doc.title).toBe(`${FR} · ${BASE}`);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("puts the prefix back when something else rewrites the title", () => {
    const doc = { title: BASE };
    let onChange = () => {};
    const unwatch = vi.fn();
    const alert = createTurnAlert({
      document: doc,
      navigator: {},
      watchTitle: (callback) => {
        onChange = callback;
        return unwatch;
      },
    });
    alert.update("1:vote", { prefix: FR, vibrate: false });
    doc.title = BASE; // Next.js metadata after a refresh
    onChange();
    expect(doc.title).toBe(`${FR} · ${BASE}`);
    alert.update(null, { prefix: FR, vibrate: false });
    expect(unwatch).toHaveBeenCalledTimes(1);
    expect(doc.title).toBe(BASE);
  });

  it("never stacks prefixes and strips stacked ones", () => {
    expect(prefixedTitle(prefixedTitle(BASE, FR), FR)).toBe(`${FR} · ${BASE}`);
    expect(unprefixedTitle(`${FR} · ${FR} · ${BASE}`, FR)).toBe(BASE);
    expect(unprefixedTitle(BASE, FR)).toBe(BASE);
  });

  it("keeps the preference in storage and survives a storage that throws", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
    expect(loadVibrationPreference(storage)).toBe(true);
    expect(saveVibrationPreference(storage, false)).toBe(true);
    expect(map.get(VIBRATION_PREFERENCE_KEY)).toBe("off");
    expect(loadVibrationPreference(storage)).toBe(false);
    saveVibrationPreference(storage, true);
    expect(loadVibrationPreference(storage)).toBe(true);

    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadVibrationPreference(broken)).toBe(true);
    expect(saveVibrationPreference(broken, false)).toBe(false);
    expect(loadVibrationPreference(null)).toBe(true);
  });
});

// ------------------------------------------------------------ component ----

const MESSAGES = { fr: { room: frRoom }, en: { room: enRoom } };

function players(count: number): PlayerSlot[] {
  return fakePlayers(count, { offline: [], afk: [] }).map((p, i) => ({ ...p, pid: `p${i}` }));
}

function roomFor(game: LocalGame, status: RoomView["status"] = "playing"): RoomView {
  return {
    code: "BCDFG",
    visibility: "private",
    lang: "fr",
    status,
    settings: { timers: "off", minPlayers: 5 },
    hostPid: "p0",
    players: players(game.state.playerCount),
    spectators: [],
    startsAt: null,
    game: null,
    result: null,
  } as RoomView;
}

function stateFor(view: PlayerView, turn: number, room: RoomView): RoomClientState {
  return {
    ...initialRoomState,
    status: "open",
    you: { pid: `p${view.me?.seat ?? 0}`, name: "x" },
    room,
    game: { turn, view, log: [] },
  };
}

function mount(state: RoomClientState, locale: "fr" | "en" = "fr") {
  const body = (s: RoomClientState) => (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Paris">
      <StaticRoomProvider state={s}>
        <TurnAlerts playing={s.room?.status === "playing"} />
      </StaticRoomProvider>
    </NextIntlClientProvider>
  );
  const result = render(body(state));
  return { ...result, update: (next: RoomClientState) => result.rerender(body(next)) };
}

/** The vote fixture: `me` still to vote, `other` another voter still to vote. */
function voteSituation() {
  const fixture = buildFixture("vote", { players: 7, seed: 3 });
  const voters = pendingActors(fixture.game.state);
  const me = (fixture.focusSeat ?? voters[0]) as Seat;
  const other = voters.find((seat) => seat !== me) as Seat;
  return { game: fixture.game, me, other };
}

function voted(game: LocalGame, seat: Seat): LocalGame {
  const result = play(game, { seat, action: { type: "vote", ja: true } });
  if (!result.ok) throw new Error(result.error);
  return result.game;
}

describe("<TurnAlerts>", () => {
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.title = BASE;
    window.localStorage.clear();
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    Object.defineProperty(navigator, "userActivation", {
      value: { hasBeenActive: true },
      configurable: true,
    });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "vibrate");
    Reflect.deleteProperty(navigator, "userActivation");
    Reflect.deleteProperty(navigator, "maxTouchPoints");
  });

  it("prefixes the title while the vote is open, once, and clears it after", () => {
    const { game, me, other } = voteSituation();
    const room = roomFor(game);
    const { update, unmount } = mount(stateFor(viewFor(game.state, me), 7, room));
    expect(document.title).toBe(`${FR} · ${BASE}`);
    expect(vibrate).toHaveBeenCalledTimes(1);

    // Another player votes: new view, same turn. Nothing new.
    const afterOther = voted(game, other);
    update(stateFor(viewFor(afterOther.state, me), 7, room));
    expect(document.title).toBe(`${FR} · ${BASE}`);
    expect(vibrate).toHaveBeenCalledTimes(1);

    // This player votes: their decision is over.
    const afterMe = voted(afterOther, me);
    update(stateFor(viewFor(afterMe.state, me), 7, room));
    expect(document.title).toBe(BASE);

    unmount();
    expect(document.title).toBe(BASE);
  });

  it("restores the title when the room unmounts mid-decision", () => {
    const { game, me } = voteSituation();
    const { unmount } = mount(stateFor(viewFor(game.state, me), 2, roomFor(game)), "en");
    expect(document.title).toBe(`● Your turn · ${BASE}`);
    unmount();
    expect(document.title).toBe(BASE);
  });

  it("does nothing for a spectator or a player with nothing to do", () => {
    const { game, me } = voteSituation();
    const room = roomFor(game);
    mount(stateFor(viewFor(game.state, "spectator"), 3, room));
    expect(document.title).toBe(BASE);
    const afterMe = voted(game, me);
    mount(stateFor(viewFor(afterMe.state, me), 3, room));
    expect(document.title).toBe(BASE);
    expect(vibrate).not.toHaveBeenCalled();
    // The switch is only for players.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("vibrates again for the next decision, unless the player turned it off", async () => {
    const user = userEvent.setup();
    const { game, me } = voteSituation();
    const room = roomFor(game);
    const { update } = mount(stateFor(viewFor(game.state, me), 4, room));
    expect(vibrate).toHaveBeenCalledTimes(1);

    const box = screen.getByRole("checkbox", {
      name: "Faire vibrer le téléphone quand c'est à vous de jouer",
    });
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(window.localStorage.getItem(VIBRATION_PREFERENCE_KEY)).toBe("off");

    // Next decision (a new turn): title again, no vibration.
    update(stateFor(viewFor(voted(game, me).state, me), 5, room));
    update(stateFor(viewFor(game.state, me), 6, room));
    expect(document.title).toBe(`${FR} · ${BASE}`);
    expect(vibrate).toHaveBeenCalledTimes(1);

    // Back on: the decision after that buzzes.
    await user.click(box);
    expect(window.localStorage.getItem(VIBRATION_PREFERENCE_KEY)).toBeNull();
    update(stateFor(viewFor(voted(game, me).state, me), 7, room));
    update(stateFor(viewFor(game.state, me), 8, room));
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("hides the switch where the browser cannot vibrate, and after the game", () => {
    Reflect.deleteProperty(navigator, "vibrate");
    const { game, me } = voteSituation();
    const { update } = mount(stateFor(viewFor(game.state, me), 1, roomFor(game)));
    expect(screen.queryByRole("checkbox")).toBeNull();
    // Desktop browsers have the API but nothing to vibrate.
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
    update(stateFor(viewFor(game.state, me), 1, roomFor(game)));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.title).toBe(`${FR} · ${BASE}`);
    update(stateFor(viewFor(game.state, me), 1, roomFor(game, "ended")));
    expect(document.title).toBe(BASE);
  });

  it("works when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const user = userEvent.setup();
    const { game, me } = voteSituation();
    const room = roomFor(game);
    const { update } = mount(stateFor(viewFor(game.state, me), 1, room));
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    update(stateFor(viewFor(voted(game, me).state, me), 2, room));
    update(stateFor(viewFor(game.state, me), 3, room));
    expect(vibrate).toHaveBeenCalledTimes(1);
    // Back on (the choice lives in memory for the page's life).
    await act(async () => {
      await user.click(box);
    });
    expect(box).toBeChecked();
  });
});
