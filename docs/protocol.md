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

## Website side

- **Accounts** (M4): Auth.js (e-mail + password, Google when configured), JWT session cookie
  holding only the account id and its `sessionVersion`; every request reads the account row
  (`apps/web/lib/auth/current-user.ts`). An account plays under its unique display name (chosen at
  sign-up or on `/bienvenue`). Public rooms need an onboarded account (and a verified e-mail when
  `REQUIRE_EMAIL_VERIFICATION` is set): the room page asks visitors to sign in before connecting.
- **Guest identity**: the `sh_guest` cookie (httpOnly, 30 days) is an HS256 JWT signed with
  `GUEST_SECRET`, holding a random guest id and the chosen name (`apps/web/lib/guest/`). Set by
  the home and room-gate server actions; guests can create and join private rooms only.
- **Tickets**: `POST /api/rooms/:code/ticket` (same-origin, 60 per minute per identity) answers
  `{ url }`, the WebSocket URL with a fresh ticket, or `401 { error: "no_guest" }` (the page then
  asks for a name). An onboarded account gets `kind: "user"` with `blocks` = the identity keys
  it blocked (at most 500); otherwise the guest cookie is used. The browser never sees the key.
- **Public lobby** (`/jouer`, `/play`): the page opens `/v1/lobby/ws` (anyone may watch the
  list). Quick match is a server action: onboarded account → verified e-mail if required → the
  abandon cooldown (2 public games left within 24 h → 15 min) → `POST /internal/lobby/quickmatch`
  with the account's identity and **blocks in both directions** → `POST /internal/rooms`
  (public) when the lobby answers `code: null` → redirect to the room.
- **Room client** (`apps/web/lib/room-client/`): `state.ts` is a pure reducer over server
  messages, `connection.ts` the partysocket wrapper (fresh ticket per attempt, keep-alive, close
  codes), `store.tsx` the React bindings (`RoomProvider`, `useRoomState`, `useRoomActions`).
- **Invite links**: `/r/CODE` redirects to the room page in the visitor's language (`proxy.ts`).
- **CSP**: `connect-src` names the rooms host (`ROOMS_PUBLIC_URL`, else `ROOMS_URL`), read when
  the website is **built** — build with the URL browsers will use.

## Server to server

Signed with HMAC-SHA256 (`hmac.ts`, header `x-sh-signature: t=<unix>,v1=<hex>`, ±5 minutes), one
secret per direction:

- website → rooms: `POST /internal/rooms`, `GET /internal/rooms/:code`,
  `POST /internal/lobby/quickmatch`, `GET /internal/lobby`;
- rooms → website: `POST /api/internal/games` with `GameResultPayload` (from the room's outbox,
  retried with backoff for 3 days).

Game results (`apps/web/app/api/internal/games`, stored by `lib/games/ingest.ts`):

| Status                        | When                                          | Outbox does |
| ----------------------------- | --------------------------------------------- | ----------- |
| 200 `{ ok: true, duplicate }` | stored now, or already stored                 | done        |
| 400                           | not JSON, or not a valid `GameResultPayload`  | drops it    |
| 401                           | signature missing, forged or older than 5 min | retries     |
| 413                           | body over 256 KB                              | drops it    |
| 500                           | database failure                              | retries     |

- **Idempotent on `gameId`.** The first delivery writes `Game`, its `GamePlayer` rows and the
  `GameLog` in one transaction; a repeated or concurrent one answers `duplicate: true` and changes
  nothing.
- **Players.** `kind: "user"` links the account (`sub` is `User.id`) only if it still exists;
  otherwise `userId` and `name` are stored as null ("Deleted player"). Guests keep their name.
- **`left`**: the room was playing for this player when the game ended (away past the grace
  period, or kicked). Two `left` public games within 24 h → 15 min quick-match cooldown
  (`lib/games/cooldown.ts`). Defaults to false for rooms that predate it.
- Never logged: the payload holds the seed and every move.

Lobby (`LobbyRoomReport`, room → Lobby DO): besides the public entry, `members` (identity keys of
everyone in the room) and `excluded` (identities the room refuses: kicked, latest 100). Viewers
never see either. Quick match never offers a room that excluded the player, not even their own
(a kicked player stays in the game record), and skips rooms with a member listed in
`QuickMatchRequest.blocks`, which the website fills with blocks in both directions.

## Known gaps (to close in M5/M6)

- An abandoned game does not reveal the roles.
- The abandon cooldown is checked by quick match only: a player can still open a public room
  from the lobby list (or its link) during the 15 minutes.
- Banned accounts (M5) are not refused yet: tickets do not check bans.
