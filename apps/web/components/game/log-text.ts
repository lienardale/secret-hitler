/**
 * Game events as readable sentences (FR/EN messages in game.json `log.*`).
 * Private events are rendered only because the viewer was sent them; they are
 * marked so the viewer knows nobody else sees them.
 */
import { eventVisibility, type GameEvent, type Policy } from "@sh/engine";

import type { SeatNames } from "./names";
import type { GameT } from "./status";

export interface LogLine {
  text: string;
  /** Who voted what, under a vote result. */
  detail?: string;
  /** Round boundaries are drawn as separators. */
  round?: boolean;
  tone?: "liberal" | "fascist" | "danger";
  private: boolean;
}

function policies(list: readonly Policy[], t: GameT): string {
  return list.map((policy) => t(`policy.name.${policy}`)).join(", ");
}

/** A sentence for one event, or null for events not worth a line (single ballots). */
export function describeEvent(event: GameEvent, names: SeatNames, t: GameT): LogLine | null {
  const isPrivate = eventVisibility(event) !== "public";
  const line = (text: string, extra: Partial<LogLine> = {}): LogLine => ({
    text,
    private: isPrivate,
    ...extra,
  });
  const n = names.name;

  switch (event.type) {
    case "gameStarted":
      return line(t("log.gameStarted", { count: event.playerCount }));
    case "roundStarted":
      return line(
        t(event.special ? "log.roundSpecial" : "log.round", { president: n(event.president) }),
        { round: true },
      );
    case "chancellorNominated":
      return line(t("log.nominated", { president: n(event.president), nominee: n(event.nominee) }));
    case "voteCast":
      // Seats show who has voted; the result lists every ballot.
      return null;
    case "voteResult": {
      const ja = event.votes.flatMap((vote, seat) => (vote === true ? [seat] : []));
      const nein = event.votes.flatMap((vote, seat) => (vote === false ? [seat] : []));
      const values = {
        ja: ja.length,
        nein: nein.length,
        president: n(event.president),
        nominee: n(event.nominee),
      };
      const nobody = t("log.nobody");
      return line(t(event.passed ? "log.votePassed" : "log.voteFailed", values), {
        detail: t("log.voteDetail", {
          ja: ja.length ? names.list(ja) : nobody,
          nein: nein.length ? names.list(nein) : nobody,
        }),
      });
    }
    case "chancellorConfirmedNotHitler":
      return line(t("log.notHitler", { name: n(event.seat) }), { tone: "liberal" });
    case "trackerAdvanced":
      return line(t("log.tracker", { count: event.tracker }));
    case "policiesDrawn":
      return line(
        t("log.drawn", { president: n(event.president), policies: policies(event.policies, t) }),
      );
    case "presidentDiscarded":
      return line(
        t("log.presidentDiscarded", { president: n(event.president), policy: event.policy }),
      );
    case "chancellorReceived":
      return line(
        t("log.chancellorReceived", {
          chancellor: n(event.chancellor),
          policies: policies(event.policies, t),
        }),
      );
    case "chancellorDiscarded":
      return line(
        t("log.chancellorDiscarded", { chancellor: n(event.chancellor), policy: event.policy }),
      );
    case "vetoProposed":
      return line(t("log.vetoProposed", { chancellor: n(event.chancellor) }));
    case "vetoResponded":
      return line(
        t(event.agree ? "log.vetoAgreed" : "log.vetoRefused", { president: n(event.president) }),
      );
    case "policyEnacted":
      return line(t(event.byChaos ? "log.enactedChaos" : "log.enacted", { policy: event.policy }), {
        tone: event.policy === "L" ? "liberal" : "fascist",
      });
    case "deckReshuffled":
      return line(t("log.reshuffled", { count: event.deckCount }));
    case "powerGranted":
      return line(t("log.powerGranted", { president: n(event.president), power: event.power }), {
        tone: "fascist",
      });
    case "peekRevealed":
      return line(
        t("log.peeked", { president: n(event.president), policies: policies(event.policies, t) }),
      );
    case "playerInvestigated":
      return line(
        t("log.investigated", { president: n(event.president), target: n(event.target) }),
      );
    case "investigationResult":
      return line(t("log.investigationResult", { target: n(event.target), party: event.party }), {
        tone: event.party,
      });
    case "specialElectionCalled":
      return line(
        t("log.specialElection", { president: n(event.president), target: n(event.target) }),
      );
    case "playerExecuted":
      return line(t("log.executed", { president: n(event.president), target: n(event.target) }), {
        tone: "danger",
      });
    case "gameOver":
      return line(t("log.gameOver", { winner: event.winner }), { tone: event.winner });
  }
}
