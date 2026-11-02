// Public API of the Secret Hitler rules engine.
export * from "./types";
export * from "./constants";
export { apply, type ApplyResult } from "./apply";
export { setup } from "./setup";
export { legalActions, pendingActors } from "./legal";
export { defaultAction } from "./defaults";
export {
  viewFor,
  type Projected,
  type PlayerView,
  type MeView,
  type SeatView,
  type PhaseView,
  type Viewer,
  type ViewOptions,
} from "./view";
export {
  eventsFor,
  eventVisibility,
  type GameEvent,
  type GameEventType,
  type Visibility,
} from "./events";
export { knownRoles, partyOf } from "./knowledge";
export { eligibleChancellors, isEligibleChancellor, isTermLimited } from "./eligibility";
export { aliveCount, nextAlive } from "./rotation";
export { outcome } from "./outcome";
export { replay } from "./replay";
export { migrate, STATE_VERSION } from "./migrate";
export { checkInvariants } from "./invariants";
export {
  playRandomGame,
  seededRandom,
  type RandomGameOptions,
  type RandomGameResult,
} from "./simulate";
export { createRng, nextUint32, randomInt, shuffle } from "./rng";
