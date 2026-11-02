# Room protocol

How a browser talks to a game room. Schemas live in `packages/protocol` (zod, strict); this page
explains how the pieces fit. Protocol version: `PROTOCOL_VERSION` (currently 1).

## Connecting

1. The website checks the session or guest cookie and signs a **ticket**: an Ed25519 JWT valid
   **60 s**, for **one room**, accepted **once** (`ticket.ts`). Claims: `kind` (`user`/`guest`),
   `sub`, `name`, `room`, `blocks`, `mod`, `pv` (protocol version of the page).
2. The browser opens `wss://<rooms host>/v1/rooms/<CODE>/ws?t=<ticket>`. The Worker checks the
   `Origin` header (allow-list), the ticket and `pv`, then hands the socket to the room's Durable
   Object.
3. The room answers with a **`welcome`**: who you are (`you.pid`, a room-scoped id, never your
   account id), the room view, the game snapshot (your view plus every event you may see), the
   chat history, and `serverTime`.

Reconnect with partysocket and a URL provider that fetches a **fresh ticket for every attempt**
(tickets are single-use). Set `maxEnqueuedMessages: 0`: actions are never replayed after a
reconnect; the new `welcome` tells you where things stand.

## Messages

Client → room (`client-messages.ts`): `sit`, `stand`, `settings` (host), `start` (host, private),
`kick` (host), `action` (`{ turn, action }`), `chat`, `forceTurn` (host, private), `endGame`
(host, private), `rematch` (host), `sync`. Max 2 KB per message.

Room → client (`server-messages.ts`):

| Message   | When                                            | Client does                         |
| --------- | ----------------------------------------------- | ----------------------------------- |
| `welcome` | (re)connect, game start, rematch, `sync`        | replace all local state             |
| `room`    | seats, host, settings, turn or deadline changed | replace the room view               |
| `game`    | the game moved on                               | replace the view, append `events`   |
| `chat`    | a message you may see                           | append, ignore ids already seen     |
| `error`   | your last message was refused (nothing changed) | show a hint, re-enable the controls |

- **Turns.** `room.game.turn` changes at every new decision (not at each vote). Send it back in
  `action`; a stale turn is refused with `stale_turn`, so a late click never lands on the next
  decision. Don't update optimistically: wait for the `game` message.
- **Deadlines** are absolute times (`room.game.deadline`, `room.startsAt`). Turn them into
  countdowns with the clock offset from `serverTime`.
- **Chat ids** increase. A `chat` message may repeat one already in a `welcome`: skip ids you have.
- **Keep-alive.** Send the text `ping` every 30 s; the room answers `pong` without waking up.

## Close codes (`close-codes.ts`)

| Code | Meaning                                      | Client does                     |
| ---- | -------------------------------------------- | ------------------------------- |
| 4400 | too many invalid messages                    | stop, report a bug              |
| 4401 | ticket missing, expired, used, wrong room    | reconnect (fresh ticket)        |
| 4403 | guest in a public room                       | ask the player to sign in       |
| 4404 | no such room                                 | "room not found"                |
| 4409 | room full (10 players, 20 spectators)        | "room full"                     |
| 4410 | room closed after the game or for inactivity | back to the home page           |
| 4423 | kicked by the host                           | "you were removed", don't retry |
| 4426 | protocol too old                             | reload the page                 |
| 4429 | chat flood                                   | "slow down", don't retry        |

`RETRYABLE_CLOSE_CODES` lists the codes worth reconnecting after (1001, 1006, 1011–1013, 4401).

## Room rules worth knowing

- Members are seated automatically on joining a lobby with a free seat; late joiners watch.
  Several tabs of one identity share one seat.
- Private rooms: the host starts (5–10 seated, all connected); no timers unless chosen. The host
  can play the turn of a player gone 60 s (`forceTurn`) or stop the game (`endGame`).
- Public rooms (accounts only): standard timers; a 30 s countdown starts once `minPlayers` are
  seated (5 s at 10). A player gone 90 s is played automatically until they return. Fewer than
  half the living players connected for 3 minutes ends the game without a winner.
- Chat: everyone in the lobby and after the game; during the game, living players only, and the
  President and Chancellor are silent while they hold policies. 3 messages / 2 s, 5 / 10 s, plus
  a 2 s slow mode in public rooms.
- A room closes 30 minutes after a game ends (a rematch reopens the lobby before that), or after
  30 minutes with nobody connected.

## Server to server

Signed with HMAC-SHA256 (`hmac.ts`, header `x-sh-signature: t=<unix>,v1=<hex>`, ±5 minutes), one
secret per direction:

- website → rooms: `POST /internal/rooms`, `GET /internal/rooms/:code`,
  `POST /internal/lobby/quickmatch`, `GET /internal/lobby`;
- rooms → website: `POST /api/internal/games` with `GameResultPayload` (from the room's outbox,
  retried with backoff for 3 days; the website upserts on `gameId`).

## Known gaps (to close in M4/M5)

- Quick match only keeps a player away from people **they** blocked. The website should send
  blocks in both directions in `QuickMatchRequest.blocks`.
- A player kicked from a public room is not a member any more, so quick match may offer that room
  again (the room then refuses them with 4423). Add an `excluded` list to `LobbyRoomReport`.
- An abandoned game does not reveal the roles.
