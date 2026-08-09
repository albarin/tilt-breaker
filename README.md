# Tilt Breaker — chess.com

A daily per-game-type game quota for chess.com. When blitz runs out it blocks new blitz
games and leaves rapid alone. Extension for Chrome and Firefox (MV3).

## Why it exists

Chess.com offers no way to limit yourself. This extension counts what you play and cuts
off new games in whichever game type you have spent, so that extra blitz does not eat
into your rapid.

## How it behaves

- **No rematches.** "Rematch" and "New N min" are always blocked, quota or no quota. Not
  a counting rule: that button chains games without you ever deciding to play them.
  Walking back to the lobby takes a few seconds, and those seconds are the decision.
- **Counting comes from chess.com's public API**, not from reading the page. That is what
  actually knows the game type and result of every game, draws included, and it picks up
  what you play on mobile too.
- **It never interrupts a game in progress.** Abandoning costs rating. The block only
  covers the entry points to a *new* game: the lobby options, the play button and the
  rematch in the game-over modal.
- **When in doubt it does not block.** If the API cannot be reached it uses the last thing
  it knew; it never assumes you have played nothing.
- **A mandatory gap between games**, 15 minutes by default. Counted from your last game
  of *any* type: a per-type gap would be walked around by alternating bullet and blitz.
  It survives midnight, so finishing at 23:58 still holds you back at 00:05.
- **Quotas reset at midnight.** Fixed, like the 60-minute rest after a losing streak:
  values that are not up for tuning.
- **The blocking screen never names another game type**, and the popup only shows the
  ones with a quota. Saying "rapid is still available" mid-impulse is an invitation to
  keep playing, not a consolation.
- **No escape hatch.** There is no button to lift the limit, no "observe only" mode, no
  username to configure. Any of the three would be a one-click shortcut around the very
  thing you asked for. If the count is ever wrong, the way out is disabling the extension
  from the browser — deliberately more work than a click.

## Getting started

```sh
pnpm install
pnpm dev              # Chrome, with hot reload
pnpm dev:firefox      # Firefox
```

To load a build by hand:

```sh
pnpm build            # → .output/chrome-mv3
pnpm build:firefox    # → .output/firefox-mv3
pnpm zip              # store package
pnpm zip:firefox      # package + the sources zip AMO requires
```

In Chrome: `chrome://extensions` → developer mode → *Load unpacked* → `.output/chrome-mv3`.
In Firefox: `about:debugging` → *This Firefox* → *Load Temporary Add-on* →
`.output/firefox-mv3/manifest.json`. **Firefox does not grant host permissions
automatically**: give them by hand from the add-on's permissions.

### Putting it to work

There is nothing to configure. The account is detected from your chess.com session — your
profile link lives in the sidebar while your opponent's sits around the board, and that is
what tells them apart — and quotas apply from the first moment.

To check the count adds up, open the popup: it already shows what you have played today
without waiting or playing, because it comes from the API.

## How it is put together

```
src/
  core/            pure logic, no DOM and no browser APIs — where the tests live
    day.ts         the local day, daylight saving included
    gametype.ts    base + 40×increment → bullet | blitz | rapid
    policy.ts      quota, losing streak and gap → allow or block
    games.ts       from API games to the day's count
  site/
    chesscom.ts    ALL knowledge of chess.com's DOM, isolated here
    overlay.ts     the blocking screen, in a shadow root
  api/             client for chess.com's public monthly archive
  state/
    storage.ts     typed, serialised storage
    sync.ts        brings the day's count up to date
  entrypoints/
    background.ts       the only decider; queries the API and answers
    chesscom.content.ts enforces the block on the site's buttons
    popup/ options/     Svelte 5
```

### Where the count comes from

From the public monthly archive: `api.chess.com/pub/player/{username}/games/{YYYY}/{MM}`.
Measured against the live server it answers `cache-control: public, max-age=5` and a game
shows up seconds after it ends — the 12-hour refresh the docs mention belongs to other
endpoints. Requests carry `If-Modified-Since` because the archive runs close to a megabyte
mid-month.

The API has exactly one blind spot: **it only knows finished games**. That leaves a
few-second window between finishing a game and the archive learning about it — precisely
where the rematch button sits.

Blocking rematch always closes that window with nothing to track: the only way to start
another is walking back to the lobby, and that navigation takes far longer than the API
needs. A behavioural decision that turned out to be the technical simplification too.

So the only thing read from the site is which button you clicked. `location.pathname` is
polled every 400 ms to refresh the count on page changes; `history.pushState` is **not**
patched, because from a content script's isolated world that patch never sees the page's
own calls.

### Blocking

Three layers: a stylesheet that greys out blocked options, a **capture-phase** click
interceptor (which cancels the click regardless of how chess.com wires its handlers), and
the overlay that explains why.

## When chess.com changes

It will, but the damage is bounded: **counting** no longer depends on the site's markup,
only **blocking** does. If chess.com renames its buttons the extension keeps counting
correctly and stops standing in your way — which you notice immediately, instead of
failing silently.

Every selector lives in `src/site/chesscom.ts` and nowhere else. Semantic attributes and
domain classes (`time-selector-button-button`, `data-glyph="game-time-blitz"`) are
preferred over design-system ones, which carry a hash and rotate: never select on a hashed
`cc-*`.

The site console carries the full trace under the `[tilt-breaker]` prefix.

## Checks

```sh
pnpm test     # 119 tests (vitest + happy-dom)
pnpm check    # types (svelte-check)
pnpm icons    # regenerates public/icon/*.png with no external dependencies
```
