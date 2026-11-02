# Secret Hitler Online

A free web platform to play [Secret Hitler](https://www.secrethitler.com/) online:
privately with friends (share a link or a room code) or publicly with strangers.
French and English.

> Secret Hitler was created by Mike Boxleiter, Tommy Maranges, and Mac Schubert
> (© Goat, Wolf, & Cabbage). This adaptation is licensed CC BY-NC-SA 4.0 and is not
> affiliated with the original authors. See [CREDITS.md](CREDITS.md).

## Layout

| Workspace                            | What it is                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `packages/engine` (`@sh/engine`)     | The rules of the game: a pure, deterministic state machine. No I/O.         |
| `packages/protocol` (`@sh/protocol`) | Message schemas shared by the browser, the game server and the website.     |
| `apps/rooms` (`@sh/rooms`)           | Cloudflare Worker: one Durable Object per game room, plus the public lobby. |
| `apps/web` (`@sh/web`)               | Next.js website on Vercel: pages, accounts, lobby, moderation.              |

The full plan is in [docs/plan.md](docs/plan.md). Staging: https://secret-hitler-staging.vercel.app
(how it is deployed: [docs/deploy.md](docs/deploy.md)).

## Getting started

```bash
nvm use            # Node 24
npm install
npm test           # all workspaces
npm run ci:local   # the same checks CI runs
```

Run the apps:

```bash
npm run dev:setup  # once: local ticket keys and secrets (gitignored)
npm run dev:rooms  # game server on http://localhost:8787
npm run dev:web    # website on http://localhost:3000
```

Then open http://localhost:3000, create a room, and open the invite link in other browsers
(or private windows) to join as more players. `http://localhost:3000/fr/dev/table` is a
sandbox that runs the rules engine in the page, to try every screen of the game alone.

Watch bots play a whole game on the local game server (in a second terminal):

```bash
npm run bots -- --players 7 --timers fast
npm run bots -- --players 7 --kill-one   # cuts one bot's connection mid-game
```

Browser tests (Playwright) build the website and start both servers themselves:

```bash
npm -w @sh/web run build && npm -w @sh/web run e2e
```

How browsers talk to rooms (tickets, messages, close codes) is described in
[docs/protocol.md](docs/protocol.md).

Play thousands of random games against the rules engine's invariants:

```bash
npm run simulate -- --games 20000
```
