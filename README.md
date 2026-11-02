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

The full plan is in [docs/plan.md](docs/plan.md).

## Getting started

```bash
nvm use            # Node 24
npm install
npm test           # all workspaces
npm run ci:local   # the same checks CI runs
```

Run the apps:

```bash
npm run dev:rooms  # game server on http://localhost:8787
npm run dev:web    # website on http://localhost:3000
```

Play thousands of random games against the rules engine's invariants:

```bash
npm run simulate -- --games 20000
```
