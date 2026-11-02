/**
 * Who may chat, as the client can tell from its own view. The room enforces
 * the same rules (apps/rooms adapter `canChat`); this only explains why the
 * input is hidden.
 */
import type { PlayerView } from "@sh/engine";
import type { RoomView } from "@sh/protocol";

export type ChatBlock = "spectator" | "dead" | "silence";

export function chatBlockReason(
  status: RoomView["status"],
  view: PlayerView | null,
): ChatBlock | null {
  if (status !== "playing" || !view || view.phase.kind === "over") return null;
  const me = view.me;
  if (!me) return "spectator";
  const seat = view.seats[me.seat];
  if (!seat?.alive) return "dead";
  const legislative =
    view.phase.kind === "presidentDiscard" ||
    view.phase.kind === "chancellorEnact" ||
    view.phase.kind === "vetoResponse";
  if (legislative && (seat.isPresident || seat.isChancellor)) return "silence";
  return null;
}
