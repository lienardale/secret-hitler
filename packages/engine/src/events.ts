/**
 * Game events: what happened during an action, for the event log, animations
 * and replays. Some events are private (a player's hand, an investigation
 * result); `eventVisibility` says who may see each one and `eventsFor`
 * filters a list for one viewer.
 */
import type { Party, Policy, Power, Role, Seat, WinReason } from "./types";

export type GameEvent =
  | { type: "gameStarted"; playerCount: number; president: Seat }
  | { type: "roundStarted"; president: Seat; special: boolean }
  | { type: "chancellorNominated"; president: Seat; nominee: Seat }
  | { type: "voteCast"; seat: Seat }
  | {
      type: "voteResult";
      president: Seat;
      nominee: Seat;
      votes: (boolean | null)[];
      passed: boolean;
    }
  | { type: "chancellorConfirmedNotHitler"; seat: Seat }
  | { type: "trackerAdvanced"; tracker: number }
  | { type: "policiesDrawn"; president: Seat; policies: Policy[] }
  | { type: "presidentDiscarded"; president: Seat; policy: Policy }
  | { type: "chancellorReceived"; chancellor: Seat; policies: Policy[] }
  | { type: "chancellorDiscarded"; chancellor: Seat; policy: Policy }
  | { type: "vetoProposed"; chancellor: Seat }
  | { type: "vetoResponded"; president: Seat; agree: boolean }
  | { type: "policyEnacted"; policy: Policy; byChaos: boolean }
  | { type: "deckReshuffled"; deckCount: number }
  | { type: "powerGranted"; president: Seat; power: Power }
  | { type: "peekRevealed"; president: Seat; policies: Policy[] }
  | { type: "playerInvestigated"; president: Seat; target: Seat }
  | { type: "investigationResult"; president: Seat; target: Seat; party: Party }
  | { type: "specialElectionCalled"; president: Seat; target: Seat }
  | { type: "playerExecuted"; president: Seat; target: Seat }
  | { type: "gameOver"; winner: Party; reason: WinReason; roles: Role[] };

export type GameEventType = GameEvent["type"];

/** Who may see an event: everyone, or only the listed seats. */
export type Visibility = "public" | readonly Seat[];

export function eventVisibility(event: GameEvent): Visibility {
  switch (event.type) {
    case "policiesDrawn":
    case "presidentDiscarded":
    case "peekRevealed":
    case "investigationResult":
      return [event.president];
    case "chancellorReceived":
    case "chancellorDiscarded":
      return [event.chancellor];
    case "gameStarted":
    case "roundStarted":
    case "chancellorNominated":
    case "voteCast":
    case "voteResult":
    case "chancellorConfirmedNotHitler":
    case "trackerAdvanced":
    case "vetoProposed":
    case "vetoResponded":
    case "policyEnacted":
    case "deckReshuffled":
    case "powerGranted":
    case "playerInvestigated":
    case "specialElectionCalled":
    case "playerExecuted":
    case "gameOver":
      return "public";
  }
}

/** The events `viewer` may see (a seat, or a spectator who sees public events only). */
export function eventsFor(events: readonly GameEvent[], viewer: Seat | "spectator"): GameEvent[] {
  return events.filter((event) => {
    const visibility = eventVisibility(event);
    return visibility === "public" || (viewer !== "spectator" && visibility.includes(viewer));
  });
}
