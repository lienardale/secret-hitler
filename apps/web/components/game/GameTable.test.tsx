import { buildFixture, FIXTURE_NAMES, FAKE_NAMES, type FixtureName } from "@/lib/game-fixtures";
import { viewFor, type Action, type Seat } from "@sh/engine";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GameTable } from "./GameTable";
import { seatPosition } from "./Seats";
import { fixtureProps, renderIntl } from "./test-utils";

const name = (seat: Seat) => FAKE_NAMES[seat] as string;
const panel = () => screen.getByTestId("action-panel");
const picker = () => within(panel()).getByRole("group", { name: "Players you can choose" });

function targets(legal: readonly Action[], type: Action["type"]): Seat[] {
  return legal.flatMap((a) => (a.type === type && "target" in a ? [a.target] : []));
}

function setup(...args: Parameters<typeof fixtureProps>) {
  const props = fixtureProps(...args);
  const user = userEvent.setup();
  const utils = renderIntl(<GameTable {...props} />);
  return { props, user, ...utils };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GameTable — stable hooks", () => {
  it("exposes phase, power, seats and the viewer's seat", () => {
    const { props } = setup("investigate");
    const table = screen.getByTestId("game-table");
    expect(table).toHaveAttribute("data-phase", "executive");
    expect(table).toHaveAttribute("data-power", "investigate");
    const seats = screen.getAllByTestId("seat");
    expect(seats).toHaveLength(props.fixture.playerCount);
    expect(seats.map((s) => s.getAttribute("data-seat"))).toEqual(seats.map((_, i) => String(i)));
    const mine = seats.filter((s) => s.getAttribute("data-you") === "true");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveAttribute("data-seat", String(props.viewer));
  });

  it("has no data-power outside the executive phase", () => {
    setup("nominate");
    expect(screen.getByTestId("game-table")).toHaveAttribute("data-phase", "nominate");
    expect(screen.getByTestId("game-table")).not.toHaveAttribute("data-power");
  });
});

describe("GameTable — decisions", () => {
  it.each([
    ["Vote Ja! (yes)", true],
    ["Vote Nein! (no)", false],
  ])("%s sends a vote", async (label, ja) => {
    const { props, user } = setup("vote");
    await user.click(within(panel()).getByRole("button", { name: label }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "vote", ja });
  });

  it("offers exactly the legal Chancellor candidates and nominates the chosen one", async () => {
    const { props, user } = setup("nominate");
    const legal = targets(props.view.me?.legal ?? [], "nominate");
    expect(legal.length).toBeGreaterThan(0);
    const offered = within(picker())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(offered).toEqual(legal.map(name));

    const confirm = within(panel()).getByRole("button", { name: "Choose a player" });
    expect(confirm).toBeDisabled();
    const target = legal.at(-1) as Seat;
    await user.click(within(picker()).getByRole("button", { name: name(target) }));
    expect(within(picker()).getByRole("button", { name: name(target) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(panel()).getByRole("button", { name: `Nominate ${name(target)}` }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "nominate", target });
  });

  it("clicking a chosen player again clears the choice", async () => {
    const { props, user } = setup("nominate");
    const target = targets(props.view.me?.legal ?? [], "nominate")[0] as Seat;
    const button = within(picker()).getByRole("button", { name: name(target) });
    await user.click(button);
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(within(panel()).getByRole("button", { name: "Choose a player" })).toBeDisabled();
  });

  it("the President discards the chosen policy by index", async () => {
    const { props, user } = setup("presidentDiscard");
    const hand = props.view.me?.hand ?? [];
    expect(hand).toHaveLength(3);
    const cards = within(
      within(panel()).getByRole("group", { name: "Your policies" }),
    ).getAllByRole("button");
    expect(cards).toHaveLength(3);
    await user.click(cards[2] as HTMLElement);
    const label = `Discard the ${hand[2] === "L" ? "Liberal" : "Fascist"} policy`;
    await user.click(within(panel()).getByRole("button", { name: label }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "presidentDiscard", index: 2 });
  });

  it("the Chancellor enacts the chosen policy by index, with no veto before 5 fascist policies", async () => {
    const { props, user } = setup("chancellorEnact");
    const hand = props.view.me?.hand ?? [];
    expect(hand).toHaveLength(2);
    expect(within(panel()).queryByRole("button", { name: "Propose a veto" })).toBeNull();
    const cards = within(
      within(panel()).getByRole("group", { name: "Your policies" }),
    ).getAllByRole("button");
    await user.click(cards[1] as HTMLElement);
    const label = `Enact the ${hand[1] === "L" ? "Liberal" : "Fascist"} policy`;
    await user.click(within(panel()).getByRole("button", { name: label }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "chancellorEnact", index: 1 });
  });

  it("the Chancellor may propose a veto once it is unlocked", async () => {
    const { props, user } = setup("veto");
    await user.click(within(panel()).getByRole("button", { name: "Propose a veto" }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "proposeVeto" });
  });

  it("after a refused veto the Chancellor is told and cannot propose again", () => {
    setup("vetoRefused");
    expect(within(panel()).getByText(/refused the veto: you must enact a policy/)).toBeVisible();
    expect(within(panel()).queryByRole("button", { name: "Propose a veto" })).toBeNull();
  });

  it.each([
    ["Agree to the veto", true],
    ["Refuse the veto", false],
  ])("the President can %s", async (label, agree) => {
    const { props, user } = setup("vetoResponse");
    await user.click(within(panel()).getByRole("button", { name: label }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "respondVeto", agree });
  });

  it.each([
    ["investigate", "Investigate"],
    ["specialElection", "Make"],
  ] as const)(
    "the %s picker offers the legal targets and sends the choice",
    async (power, verb) => {
      const { props, user } = setup(power);
      const legal = targets(props.view.me?.legal ?? [], power);
      expect(
        within(picker())
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(legal.map(name));
      const target = legal[0] as Seat;
      await user.click(within(picker()).getByRole("button", { name: name(target) }));
      await user.click(
        within(panel()).getByRole("button", { name: new RegExp(`^${verb} ${name(target)}`) }),
      );
      expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: power, target });
    },
  );

  it("an execution asks for confirmation inside the panel", async () => {
    const { props, user } = setup("execute");
    const legal = targets(props.view.me?.legal ?? [], "execute");
    expect(
      within(picker())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(legal.map(name));
    const target = legal[0] as Seat;
    await user.click(within(picker()).getByRole("button", { name: name(target) }));
    await user.click(within(panel()).getByRole("button", { name: `Execute ${name(target)}` }));
    expect(props.onAction).not.toHaveBeenCalled();

    const dialog = within(panel()).getByRole("alertdialog", { name: `Execute ${name(target)}?` });
    expect(within(picker()).getByRole("button", { name: name(target) })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(panel()).queryByRole("alertdialog")).toBeNull();

    await user.click(within(panel()).getByRole("button", { name: `Execute ${name(target)}` }));
    await user.click(within(panel()).getByRole("button", { name: `Yes, execute ${name(target)}` }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "execute", target });
  });

  it("policy peek shows the top three policies, then acknowledges", async () => {
    const fixture = buildFixture("peek", { players: 5, seed: 3 });
    const { props, user } = setup(fixture);
    const peek = props.view.me?.peek ?? [];
    expect(peek).toHaveLength(3);
    const items = within(panel()).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(
      peek.map((p, i) => `${p === "L" ? "Liberal" : "Fascist"}${["1st", "2nd", "3rd"][i]}`),
    );
    await user.click(within(panel()).getByRole("button", { name: "Done, continue" }));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ type: "acknowledgePeek" });
  });

  it.each(["vote", "nominate", "presidentDiscard", "veto", "vetoResponse", "execute"] as const)(
    "pending disables every control (%s)",
    async (fixture) => {
      const { props, user } = setup(fixture, "focus", { pending: true });
      const buttons = within(panel()).getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) expect(button).toBeDisabled();
      for (const button of buttons) await user.click(button);
      expect(props.onAction).not.toHaveBeenCalled();
      expect(within(panel()).getByRole("status")).toHaveTextContent("Sending…");
    },
  );

  it("a player with nothing to do gets no controls", () => {
    const fixture = buildFixture("nominate", { players: 7, seed: 3 });
    const idle = (fixture.game.state.president + 1) % 7;
    setup(fixture, idle);
    expect(within(panel()).queryAllByRole("button")).toHaveLength(0);
    expect(panel()).toHaveTextContent("Nothing to do right now.");
  });

  it("an executed player is told they can no longer act", () => {
    setup("dead");
    expect(within(panel()).queryAllByRole("button")).toHaveLength(0);
    expect(panel()).toHaveTextContent("You have been executed.");
  });
});

describe("GameTable — spectators", () => {
  it.each(FIXTURE_NAMES)("get no action panel and no role card (%s)", (fixture) => {
    setup(fixture, "spectator");
    expect(screen.queryByTestId("action-panel")).toBeNull();
    expect(screen.queryByRole("region", { name: "Your role" })).toBeNull();
    expect(screen.queryAllByTestId("seat").filter((s) => s.hasAttribute("data-you"))).toHaveLength(
      0,
    );
  });
});

describe("RoleCard", () => {
  function roleSetup() {
    const result = setup("nominate");
    const region = screen.getByRole("region", { name: "Your role" });
    const button = within(region).getByRole("button", { name: "Hold to see your role" });
    const role = result.props.view.me?.role ?? "liberal";
    const roleName = { liberal: "Liberal", fascist: "Fascist", hitler: "Hitler" }[role];
    const shown = () => within(region).queryAllByText(roleName).length > 0;
    return { ...result, region, button, shown };
  }

  it("hides the role until pressed and held", () => {
    const { button, shown, region } = roleSetup();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(shown()).toBe(false);
    expect(within(region).getByText("Secret role")).toBeInTheDocument();

    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(shown()).toBe(true);
    expect(within(region).getByText("What you know")).toBeInTheDocument();

    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(shown()).toBe(false);
  });

  it("a plain mouse click does not leave it revealed", () => {
    const { button, shown } = roleSetup();
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    fireEvent.click(button, { detail: 1 });
    expect(shown()).toBe(false);
  });

  it("is a keyboard toggle that hides again on blur", async () => {
    const { button, shown, user } = roleSetup();
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(shown()).toBe(true);
    await user.keyboard("{Enter}");
    expect(shown()).toBe(false);
    fireEvent.click(button, { detail: 0 });
    expect(shown()).toBe(true);
    fireEvent.blur(button);
    expect(shown()).toBe(false);
  });

  it("shows teammates to a fascist and investigation results to the investigator", () => {
    const fascists = buildFixture("nominate", { players: 7, seed: 3 });
    const fascist = fascists.game.state.roles.indexOf("fascist");
    const { unmount } = setup(fascists, fascist);
    let region = screen.getByRole("region", { name: "Your role" });
    fireEvent.pointerDown(within(region).getByRole("button"), { button: 0, pointerId: 1 });
    const hitler = fascists.game.state.roles.indexOf("hitler");
    expect(within(region).getByText(`${name(hitler)}: Hitler`)).toBeInTheDocument();
    unmount();

    const investigated = buildFixture("investigationResult", { players: 7, seed: 3 });
    const { props } = setup(investigated);
    region = screen.getByRole("region", { name: "Your role" });
    fireEvent.pointerDown(within(region).getByRole("button"), { button: 0, pointerId: 1 });
    const result = props.view.me?.investigations[0];
    expect(result).toBeDefined();
    expect(within(region).getByText("Your investigations")).toBeInTheDocument();
    expect(
      within(region).getByText(
        `${name(result?.target ?? 0)}: ${result?.party === "liberal" ? "Liberal" : "Fascist"} party`,
      ),
    ).toBeInTheDocument();
  });
});

describe("GameTable — game over", () => {
  it.each(["liberalWin", "fascistWin", "hitlerElected", "hitlerExecuted"] as const)(
    "%s shows the winner and every role",
    (fixtureName) => {
      const { props } = setup(fixtureName, 0);
      const over = screen.getByTestId("game-over");
      const phase = props.view.phase;
      if (phase.kind !== "over") throw new Error("not over");
      expect(over).toHaveAttribute("data-winner", phase.winner);
      expect(within(over).getByRole("heading", { level: 2 })).toHaveTextContent(
        phase.winner === "liberal" ? "The Liberals win!" : "The Fascists win!",
      );
      const roles = props.view.roles ?? [];
      const items = within(over).getAllByRole("listitem");
      expect(items).toHaveLength(props.fixture.playerCount);
      items.forEach((item, seat) => {
        expect(item).toHaveTextContent(name(seat));
        const label = { liberal: "Liberal", fascist: "Fascist", hitler: "Hitler" }[
          roles[seat] ?? "liberal"
        ];
        expect(item).toHaveTextContent(label);
      });
      expect(screen.queryByTestId("action-panel")).toBeNull();
    },
  );

  it.each([0, "spectator"] as const)(
    "a game the room stopped shows every role to %s, and no controls",
    (viewer) => {
      const fixture = buildFixture("vote", { players: 7, seed: 3 });
      setup(fixture, viewer, { view: viewFor(fixture.game.state, viewer, { stopped: true }) });
      const over = screen.getByTestId("game-over");
      expect(over).toHaveAttribute("data-stopped");
      expect(over).not.toHaveAttribute("data-winner");
      expect(within(over).getByRole("heading", { level: 2 })).toHaveTextContent(
        "Game stopped with no winner",
      );
      const items = within(over).getAllByRole("listitem");
      expect(items).toHaveLength(7);
      items.forEach((item, seat) => {
        const role = fixture.game.state.roles[seat] ?? "liberal";
        expect(item).toHaveTextContent(
          { liberal: "Liberal", fascist: "Fascist", hitler: "Hitler" }[role],
        );
      });
      expect(screen.queryByTestId("action-panel")).toBeNull();
    },
  );

  it("tells the viewer whether they won", () => {
    const fixture = buildFixture("liberalWin", { players: 7, seed: 3 });
    const liberal = fixture.game.state.roles.indexOf("liberal");
    setup(fixture, liberal);
    expect(screen.getByTestId("game-over")).toHaveTextContent("You won.");
  });
});

describe("EventLog", () => {
  it("renders events as sentences with player names", () => {
    const { props } = setup("nominate");
    const log = screen.getByRole("region", { name: "Game log" });
    const nominated = props.log.find((e) => e.type === "chancellorNominated");
    if (nominated?.type !== "chancellorNominated") throw new Error("no nomination");
    const who = (seat: Seat) => (seat === props.viewer ? `${name(seat)} (you)` : name(seat));
    expect(
      within(log).getByText(
        `${who(nominated.president)} nominates ${who(nominated.nominee)} for Chancellor.`,
      ),
    ).toBeInTheDocument();
    expect(within(log).getByText("The game begins with 7 players.")).toBeInTheDocument();
    expect(within(log).getAllByText(/^Ja!: .* · Nein!: /).length).toBeGreaterThan(0);
  });

  it("marks private events", () => {
    const { props } = setup("chancellorEnact");
    const log = screen.getByRole("region", { name: "Game log" });
    expect(props.log.some((e) => e.type === "chancellorReceived")).toBe(true);
    expect(within(log).getAllByText("Private").length).toBeGreaterThan(0);
    expect(
      within(log).getAllByText(/receives: (Liberal|Fascist), (Liberal|Fascist)\./).length,
    ).toBe(props.log.filter((e) => e.type === "chancellorReceived").length);
  });

  it("announces new events politely, not the initial history", () => {
    const fixture = buildFixture("vote", { players: 7, seed: 3 });
    const props = fixtureProps(fixture, "spectator");
    const { rerenderIntl } = renderIntl(<GameTable {...props} />);
    const live = within(screen.getByRole("region", { name: "Game log" })).getByText(
      (_, el) => el?.getAttribute("aria-live") === "polite",
    );
    expect(live).toHaveTextContent("");
    rerenderIntl(
      <GameTable {...props} log={[...props.log, { type: "trackerAdvanced", tracker: 2 }]} />,
    );
    expect(live).toHaveTextContent("The election tracker moves to 2 of 3.");
  });
});

describe("GameTable — turn changes", () => {
  it("moves focus to the action panel and announces the turn", () => {
    const fixture = buildFixture("nominate", { players: 7, seed: 3 });
    const props = fixtureProps(fixture);
    const me = props.view.me;
    if (!me) throw new Error("no me");
    const waiting = { ...props.view, me: { ...me, legal: [] } };
    const { rerenderIntl } = renderIntl(<GameTable {...props} view={waiting} />);
    expect(screen.queryByRole("heading", { name: "Nominate a Chancellor" })).toBeNull();

    rerenderIntl(<GameTable {...props} turn={2} />);
    expect(screen.getByRole("heading", { name: "Nominate a Chancellor" })).toHaveFocus();
    expect(within(panel()).getByText("Your turn: nominate a Chancellor.")).toBeInTheDocument();
  });

  it("does not steal focus from someone typing in the chat", () => {
    const fixture = buildFixture("nominate", { players: 7, seed: 3 });
    const props = fixtureProps(fixture);
    const me = props.view.me;
    if (!me) throw new Error("no me");
    const aside = <input aria-label="Chat message" />;
    const waiting = { ...props.view, me: { ...me, legal: [] } };
    const { rerenderIntl } = renderIntl(<GameTable {...props} view={waiting} aside={aside} />);
    const input = screen.getByRole("textbox", { name: "Chat message" });
    input.focus();
    rerenderIntl(<GameTable {...props} turn={2} aside={aside} />);
    expect(input).toHaveFocus();
    expect(within(panel()).getByText("Your turn: nominate a Chancellor.")).toBeInTheDocument();
  });
});

describe("GameTable — timer", () => {
  it("counts down from the deadline and turns urgent under 10 s", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const props = fixtureProps("vote", "focus", { deadline: 1_000_000 + 45_000, clockOffset: 0 });
    renderIntl(<GameTable {...props} />);
    act(() => vi.advanceTimersByTime(300));
    const timer = screen.getByRole("timer", { name: "Time left" });
    expect(timer).toHaveTextContent("0:45");
    expect(timer).not.toHaveClass("sh-urgent");
    act(() => vi.advanceTimersByTime(36_000));
    expect(timer).toHaveTextContent("0:09");
    expect(timer).toHaveClass("sh-urgent");
    act(() => vi.advanceTimersByTime(20_000));
    expect(timer).toHaveTextContent("0:00");
  });

  it("uses the server clock offset", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const props = fixtureProps("vote", "focus", {
      deadline: 1_000_000 + 45_000,
      clockOffset: 15_000,
    });
    renderIntl(<GameTable {...props} />);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("timer")).toHaveTextContent("0:30");
  });

  it("shows no timer without a deadline", () => {
    setup("vote");
    expect(screen.queryByRole("timer")).toBeNull();
  });
});

describe("GameTable — French", () => {
  it("renders the vote in French", async () => {
    const props = fixtureProps("vote");
    const user = userEvent.setup();
    renderIntl(<GameTable {...props} />, "fr");
    await user.click(screen.getByRole("button", { name: "Voter Nein! (non)" }));
    expect(props.onAction).toHaveBeenCalledWith({ type: "vote", ja: false });
    expect(screen.getByRole("region", { name: "Journal de la partie" })).toBeInTheDocument();
  });
});

describe("GameTable — every fixture renders", () => {
  const cases: [FixtureName, number][] = FIXTURE_NAMES.flatMap((n) =>
    [5, 7, 10].map((p): [FixtureName, number] => [n, p]),
  );
  it.each(cases)("%s with %i players, for every seat and a spectator", (fixtureName, players) => {
    const fixture = buildFixture(fixtureName, { players, seed: 3 });
    const viewers = [
      ...Array.from({ length: fixture.playerCount }, (_, s) => s),
      "spectator" as const,
    ];
    for (const viewer of viewers) {
      const { unmount } = renderIntl(<GameTable {...fixtureProps(fixture, viewer)} />);
      expect(screen.getByTestId("game-table")).toBeInTheDocument();
      expect(screen.getAllByTestId("seat")).toHaveLength(fixture.playerCount);
      unmount();
    }
  });
});

describe("seatPosition", () => {
  it("puts the viewer at the bottom centre and spreads seats without overlap", () => {
    expect(seatPosition(0, 7)).toEqual({ x: 50, y: 93 });
    for (let n = 5; n <= 10; n++) {
      const points = Array.from({ length: n }, (_, k) => seatPosition(k, n));
      const keys = new Set(points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`));
      expect(keys.size).toBe(n);
      // Clockwise from the bottom: the next seat is to the viewer's left.
      expect((points[1] as { x: number }).x).toBeLessThan(50);
    }
  });
});
