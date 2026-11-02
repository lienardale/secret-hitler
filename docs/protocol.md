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
| 4451 | account suspended by a moderator             | show the suspension, no retry   |

`RETRYABLE_CLOSE_CODES` lists the codes worth reconnecting after (1001, 1006, 1011–1013, 4401).

4451 is sent when a moderator bans the account (`POST /internal/moderation`) and on every later
join of that room, ahead of 4423. The ticket route refuses a banned account before any socket
opens (403 `banned`), and the room client shows the same notice for both.

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
  a 2 s slow mode in public rooms. Messages with a slur, a Nazi slogan or incitement against a
  group (FR + EN, `containsSlur` in `packages/protocol/src/moderation/filters.ts`, lists in
  `words.ts`; ordinary swearing and the game's own words are allowed) are refused with
  `chat_offensive`; they use up a
  send slot and count as a strike, so 8 within 30 s close the socket (4429) even when slow.
- Blocks: a member never receives chat from identities in their ticket's `blocks` (live or in the
  `welcome` history). Mute is client-side only (per room, `localStorage`).
- Kicks: the host may remove anyone in a private room, and in a public room only before the game
  starts (afterwards `private_only`; moderators use bans). A kicked or banned seat stays in the
  game and is played by the room; it never counts as `left` (an abandon).
- An ended game, abandoned or stopped by the host included, shows every role to everyone (the
  engine's `viewFor(…, { stopped: true })`).
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
  An account is refused with `403 { error: "banned" }` while a ban is active, and with
  `403 { error: "cooldown", until }` when it is in the abandon cooldown and the room is a public
  lobby (it may still watch running games and private rooms). Every account ticket records a
  `RoomVisit` (pruned after 7 days), so a later ban or forced rename reaches the account's live
  rooms. Bans apply to accounts only: guests are never refused for a ban.
- **Public lobby** (`/jouer`, `/play`): the page opens `/v1/lobby/ws` (anyone may watch the
  list). Quick match is a server action: onboarded account → not banned → verified e-mail if
  required → the abandon cooldown (2 public games left within 24 h → 15 min) → `POST /internal/lobby/quickmatch`
  with the account's identity and **blocks in both directions** → `POST /internal/rooms`
  (public) when the lobby answers `code: null` → redirect to the room.
- **Room client** (`apps/web/lib/room-client/`): `state.ts` is a pure reducer over server
  messages, `connection.ts` the partysocket wrapper (fresh ticket per attempt, keep-alive, close
  codes), `store.tsx` the React bindings (`RoomProvider`, `useRoomState`, `useRoomActions`).
  A ticket answer of 401 (ask for a name), 404, 403 `banned` (shown as the 4451 notice) or 403
  `cooldown` (a notice with the time) ends the session; anything else is retried. Code **1000**
  is retried too unless the client closed the socket: partysocket reports its own failures
  (socket error, connection timeout, failed ticket fetch) as a 1000 the server never sent
  (`.debug/008`). `reconnect()` drops the socket for a fresh ticket (after blocking someone, so
  the new ticket carries the block).
- **Player menu** (`components/room/PlayerMenu.tsx`, "Actions pour {name}"): mute for everyone
  (client-side, `localStorage` key `sh:muted:<CODE>`, pids, dropped after 7 days); block and
  report between accounts only. Report and block are server actions in
  `app/[locale]/salle/[code]/actions.ts` (same origin, onboarded account, 10 reports and 30 blocks
  per hour per account), which call the room (§ Moderation).
- **Invite links**: `/r/CODE` redirects to the room page in the visitor's language (`proxy.ts`).
- **CSP**: `connect-src` names the rooms host (`ROOMS_PUBLIC_URL`, else `ROOMS_URL`), read when
  the website is **built** — build with the URL browsers will use.

## Server to server

Signed with HMAC-SHA256 (`hmac.ts`, header `x-sh-signature: t=<unix>,v1=<hex>`, ±5 minutes), one
secret per direction:

- website → rooms: `POST /internal/rooms`, `GET /internal/rooms/:code`,
  `POST /internal/lobby/quickmatch`, `GET /internal/lobby`, and for moderation (M5)
  `POST /internal/rooms/:code/report`, `POST /internal/rooms/:code/member`,
  `POST /internal/moderation` (below);
- rooms → website: `POST /api/internal/games` with `GameResultPayload` and
  `POST /api/internal/reports` with `ReportPayload` (both from the room's outbox, retried with
  backoff for 3 days).

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
- **`left`**: the room was playing for this player when the game ended because they were away
  past the grace period. A seat removed by the host or by a moderator is played by the room too
  but is not `left`. Two `left` public games within 24 h → 15 min cooldown
  (`lib/games/cooldown.ts`): quick match and public-lobby tickets are refused. Defaults to false
  for rooms that predate it.
- Never logged: the payload holds the seed and every move.

Lobby (`LobbyRoomReport`, room → Lobby DO): besides the public entry, `members` (identity keys of
everyone in the room) and `excluded` (identities the room refuses: kicked, then banned, latest
100). The Lobby DO also answers `roomsWith(identity)` for moderation. Viewers
never see either. Quick match never offers a room that excluded the player, not even their own
(a kicked player stays in the game record), and skips rooms with a member listed in
`QuickMatchRequest.blocks`, which the website fills with blocks in both directions.

## Moderation (M5)

Schemas in `packages/protocol/src/moderation-api.ts`. A report starts in the room, so the website
never has to trust a browser's copy of the chat:

1. The room page's report dialog calls a server action (onboarded account, 10 reports per hour),
   which picks a `reportId` and calls `POST /internal/rooms/:code/report`
   `{ reportId, reporter: "u:<id>", target: <pid>, reason, details }`.
2. The room checks both parties and builds the **evidence** itself: room status, the current game
   `{ id, number }`, members (pid, kind, sub, name, seat, host, connected), the latest 100 chat
   messages (system ones included, blocks ignored) and the game's events as a spectator sees
   them (no hidden information). It queues a `ReportPayload` in its outbox (outbox id =
   `reportId`, so a repeated report is queued once) and the alarm posts it to
   `POST /api/internal/reports`. The room's purge waits for its outbox to empty.
3. The website stores a `Report` (id = `reportId`). This is the only place chat is ever written to
   Postgres.

| Route (website → rooms)             | Answers                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /internal/rooms/:code/report` | 202 `{ ok }` queued · 404 `no_room` · 422 `not_member` / `unknown_target` / `self` / `guest_target` · 400 · 401 |
| `POST /internal/rooms/:code/member` | 200 `{ kind, sub, name }` · 422 `not_member` (asked first) · 404 `unknown_target` / `no_room`                   |
| `POST /internal/moderation`         | 200 `{ applied: [codes] }` · 400 (incl. a guest identity) · 401                                                 |

- `member` serves "block this player" in a room: the website learns who is behind a pid only for
  a requester who is a member of that room.
- `moderation` applies `{ kind: "ban" }` or `{ kind: "rename", name }` to the listed rooms plus
  the public rooms the Lobby DO knows the account is in (deduplicated, at most 100). **Ban**: the
  key is stored in the room's `banned` list (even for a non-member, so a ticket issued just before
  is refused), the member's sockets close with 4451, a seated player keeps the seat and is played
  by the room, a lobby member or spectator is removed, `playerRemoved {name}`; a banned host hands
  over at once. **Rename**: the member's name becomes the new one (made unique in the room),
  `playerRenamed {old, name}`. `applied` lists the rooms where the account was a member.

Reports (`apps/web/app/api/internal/reports`, stored by `lib/moderation/ingest.ts`):

| Status                        | When                                                         | Outbox does |
| ----------------------------- | ------------------------------------------------------------ | ----------- |
| 200 `{ ok: true, duplicate }` | stored now, or already stored                                | done        |
| 400                           | not JSON, or not a valid `ReportPayload`                     | drops it    |
| 401                           | signature missing, forged, older than 5 min, or another path | retries     |
| 413                           | body over 256 KB                                             | drops it    |
| 500                           | database failure                                             | retries     |

- **Idempotent on `reportId`** (`INSERT … ON CONFLICT DO NOTHING`): a repeated or concurrent
  delivery answers `duplicate: true` and changes nothing.
- `reporterId` / `targetId` link the accounts only when the party is a `user` that still exists;
  the names in the room are always kept. Never logged: the payload holds chat.

## Known gaps (to close in M6)

- None open from M4/M5. (Closed in M5: abandoned games now reveal the roles; the abandon cooldown
  is enforced by the ticket route too; banned accounts are refused at the ticket route and their
  live sockets closed.)
