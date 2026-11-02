# Credits

The website shows the same information at `/credits` (`apps/web/messages/{fr,en}/credits.json`).
Keep the two in step: `apps/web/tests/unit/credits-sync.test.ts` fails when the number of items
under "What we changed" differs.

## The original game

**Secret Hitler was created by Mike Boxleiter, Tommy Maranges, and Mac Schubert.**
Secret Hitler © 2016-2021 Goat, Wolf, & Cabbage LLC — <https://www.secrethitler.com/>

The game is released under the
[Creative Commons BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) license.
This project uses it under the same terms: credit, no commercial use, same license.
It is not affiliated with or endorsed by Goat, Wolf, & Cabbage.

- Official rules: <https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf>
- Official print & play: <https://www.secrethitler.com/assets/Secret_Hitler_Print_and_Play.pdf>

## No money

The site is free: no ads, no paid features, no app-store version, and it will never be sold.

## Artwork

No artwork from the original game is used. The policy cards, the party and role emblems, the
power icons and the app icon are simple original drawings made for this project, written as SVG
in code: `apps/web/components/game/art/` (`emblems.tsx`, `icons.tsx`),
`apps/web/components/game/cards.tsx`, and the app icon drawn from the same emblems in
`apps/web/lib/pwa/icons.ts` (`apps/web/app/icon.svg`, the PNG icons). They are shared under this
project's license (CC BY-NC-SA 4.0).

## Fonts

- [Germania One](https://fonts.google.com/specimen/Germania+One) by John Vargas Beltrán and
  [Jost](https://fonts.google.com/specimen/Jost) by Owen Earl (The Jost Project Authors), both
  under the [SIL Open Font License 1.1](https://openfontlicense.org/). They are loaded with
  `next/font` and served by the site itself.
- The original game's commercial fonts are not used.

## Open-source software

Dependencies, vendored word lists and the common-password list are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## What we changed

The CC license asks adaptations to say what they changed. Compared with the board game:

- **Played online.** The site deals the roles, shuffles the policies and enforces every rule
  instead of the players. Seats around the table are drawn at random when a game starts. Table
  talk happens in a text chat.
- **Our own artwork.** The cards, emblems and icons are simple drawings made for this site, and
  the fonts are free alternatives. The original artwork and fonts are not used.
- **Chat silences.** The President and the Chancellor cannot write in the chat during the
  legislative session (the official rules only forbid them to communicate with each other).
  Executed players cannot write until the game ends. Spectators can write only before and after
  a game.
- **Turn timers.** Public games always have timers. The standard ones (the default) give 60 s to
  nominate, 45 s to vote, 45 s for each policy choice, 30 s to answer a veto, 60 s to investigate
  or to call a special election, 90 s to execute and 20 s for a policy peek; the host may pick
  relaxed timers (twice as long) or fast ones instead. Private games have no timers unless the
  host picks some.
- **Default moves.** When time runs out, or for a player the site plays for, the site votes
  Nein, refuses a veto, and otherwise makes a random allowed choice (never a veto proposal).
- **Disconnected players.** In a public game, a player disconnected for 90 seconds is played
  automatically until they reconnect. In a private game the seat waits; the host may play the
  turn of a player who has been disconnected for at least a minute.
- **Removing players.** In a private room the host can remove anyone, even during a game: the
  removed player cannot come back to that room, and the site plays their seat until the end. In
  a public room the host can remove people only before the game starts; after that, only
  moderators can, by suspending an account, with the same effect.
- **Abandoned games.** A public game ends with no winner when fewer than half of the living
  players stay connected for 3 minutes. A private game ends with no winner when its host stops
  it, or after 6 hours with nobody connected. Every role is then revealed, as at the end of a
  game.
- **Quick-match cooldown.** A public game counts as abandoned by a player when it ends while the
  site is playing for them because they were away (not because they were removed). After 2 such
  games within 24 hours, the player waits 15 minutes before quick match or joining another
  public room.
- **Starting a public game.** There is no ready check: a 30-second countdown starts as soon as
  enough connected players are seated (the host sets the minimum, from 5 to 10, 7 by default),
  cut to 5 seconds when the table is full (10 players). A private game starts when its host
  decides, with 5 to 10 seated players, all connected.
- **Spectators.** People who arrive after the start, or who do not take a seat, watch the game
  (up to 20 per room). They see only what is public.
- **In French and English.** The interface and the site's summary of the rules are in French and
  English; the official rules are in English.

This list is kept up to date as the project evolves.
