# Tilt Breaker — chess.com

A daily per-game-type game quota for chess.com. When blitz runs out it blocks new blitz
games and leaves rapid alone. Extension for Chrome and Firefox (MV3).

Not affiliated with Chess.com. It only uses their public API and your own account.

## Why it exists

Chess.com offers no way to limit yourself. This extension counts what you play and cuts
off new games in whichever game type you have spent, so that extra blitz does not eat
into your rapid.

## How it behaves

- **No rematches.** "Rematch" and "New N min" are always blocked, quota or no quota. Not
  a counting rule: that button chains games without you ever deciding to play them.
  Walking back to the lobby takes a few seconds, and those seconds are the decision.
- **Everything blocked is greyed out, never hidden.** One treatment for every control it
  refuses, so a refusal always looks like a refusal — not like the page breaking.
- **Counting comes from chess.com's public API**, not from reading the page. That is what
  actually knows the game type and result of every game, draws included, and it picks up
  what you play on mobile too.
- **It never interrupts a game in progress.** Abandoning costs rating. The block only
  covers the entry points to a _new_ game: the lobby options, the play button, and the
  "Rematch" / "New N min" pair — which chess.com renders twice when a game ends, once in
  the game-over modal and again in the sidebar, where it outlives dismissing the modal.
- **When in doubt it does not block.** If the API cannot be reached it uses the last thing
  it knew; it never assumes you have played nothing.
- **A mandatory gap between games**, 15 minutes by default. Counted from your last game
  of _any_ type: a per-type gap would be walked around by alternating bullet and blitz.
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

In Chrome: `chrome://extensions` → developer mode → _Load unpacked_ → `.output/chrome-mv3`.
In Firefox: `about:debugging` → _This Firefox_ → _Load Temporary Add-on_ →
`.output/firefox-mv3/manifest.json`. **Firefox does not grant host permissions
automatically**: give them by hand from the add-on's permissions.

### Putting it to work

There is nothing to configure. The account is detected from your chess.com session — your
profile link lives in the sidebar while your opponent's sits around the board, and that is
what tells them apart — and quotas apply from the first moment.

To check the count adds up, open the popup: it already shows what you have played today
without waiting or playing, because it comes from the API.

## What you can change

Four things, in the settings page:

| Setting                                  | Default                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Games per day, per game type             | 8 bullet, 6 blitz, 3 rapid (blank for no limit, `0` for none at all) |
| Minutes between games                    | 15 (`0` switches it off)                                             |
| Losses in a row before a game type locks | 3                                                                    |
| Block the rematch button                 | on                                                                   |

Two things you cannot: quotas reset at **midnight**, and a losing streak locks that game
type for **60 minutes**. Both are fixed so there is one less dial to turn on a bad night.

There is no account to configure — it is read from your chess.com session.

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
  api/             client for chess.com's public archive and profile
  state/
    storage.ts     typed storage; every read-modify-write is serialised
    sync.ts        brings the day's count up to date
  ui/              shared by the two pages: palette, formatting, icons
  messaging.ts     the whole content script ↔ background protocol
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

The API has exactly one blind spot: **it takes a few seconds to publish a finished game**.
Until it does, the gap between games is measured from the _previous_ one — and after a
long game that gap has already expired, so nothing blocks. Short games hide it, because
the previous game was recent enough that the stale gap happened to still be running.

Blocking rematch does not close this on its own: it covers the buttons that chain a game,
not walking back to the lobby. So the content script reports the moment one of your games finishes,
and the gap starts from there. The stored end never moves backwards, so the archive can
only ever confirm it.

Beyond that, the only thing read from the site is which button you clicked. `location.pathname` is
polled every 400 ms to refresh the count on page changes; `history.pushState` is **not**
patched, because from a content script's isolated world that patch never sees the page's
own calls.

### Blocking

Three layers: a stylesheet that greys out blocked options, a **capture-phase** click
interceptor (which cancels the click regardless of how chess.com wires its handlers), and
the overlay that explains why.

The overlay covers the whole viewport, so it takes the button, Escape or a click outside
the card to dismiss — one exit would leave the page unusable if anything went wrong with
it. Its shadow root is closed all the same: leaving should be easy for you, not for a
script on the page reaching in to delete it.

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

## Building from source

Reproducing the submitted packages, byte-for-byte inputs aside:

```sh
corepack enable          # or install pnpm 10 yourself
pnpm install --frozen-lockfile
pnpm zip                 # → .output/tilt-breaker-<version>-chrome.zip
pnpm zip:firefox         # → .output/tilt-breaker-<version>-firefox.zip + -sources.zip
```

Built with Node 20+ and pnpm 10 (both pinned in `package.json`). The toolchain is
[WXT](https://wxt.dev) over Vite, with Svelte 5 and TypeScript; `wxt.config.ts` holds the
manifest, which WXT emits per browser — MV3 in both, `service_worker` for Chrome and
`background.scripts` for Firefox.

There is no minification step to undo: the bundles under `.output` correspond directly to
the sources in `src`.

## Checks

```sh
pnpm test          # 180 tests (vitest + happy-dom)
pnpm check         # types (svelte-check)
pnpm smoke         # builds, then drives the settings page in a real Chrome
pnpm format        # prettier, configured to match what the code already used
pnpm format:check  # the same, read-only
pnpm icons         # regenerates public/icon/*.png with no external dependencies
```

`pnpm smoke` exists because of a bug the other checks all missed: the settings page passed
reactive state — a proxy — to `browser.storage`, which structured-clones and cannot clone
one. Every write rejected in the browser while the types checked out and the suite stayed
green, since the storage double kept whatever it was handed. The double now clones the way
the browser does (`src/test-setup.ts`), which is what the unit tests rely on; the smoke
check is what confirms that rule still matches a real browser. It needs Chrome installed.
