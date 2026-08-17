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
- **Raising a limit you have already spent asks first.** Not a refusal — the dial is
  yours — but that edit is made at the one moment it is most tempting, so it costs a
  question with the number of games you have played today in it.
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
without waiting or playing, because it comes from the API. Beside each count it shows how
those games went — wins, draws, losses — and what they did to your rating, which is the
other half of the answer to how the day is going. Your current rating sits beside each
game type's name, small and muted: the number that swing is a swing in. It comes out of
the same read as the counts — the archive reports what each game left you rated — so it
moves in the same beat as them, and falls back to `/pub/player/{username}/stats` for a
game type with no game in the months fetched.

## What you can change

Four things, in the settings page, which opens in the browser's own dialog rather than a
tab:

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
  locales/         every user-facing string, one file per language
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
endpoints. Requests are conditional because the archive runs close to a megabyte mid-month
and this is polled every few seconds while a finished game is on its way — on the `ETag`,
not on `Last-Modified`: the server sends both and honours only the first. Measured against
it, `If-Modified-Since` answers 200 with the whole archive however the stamp is spelled,
while `If-None-Match` answers 304.

The API has exactly one blind spot: **it takes a few seconds to publish a finished game**.
Until it does, the gap between games is measured from the _previous_ one — and after a
long game that gap has already expired, so nothing blocks. Short games hide it, because
the previous game was recent enough that the stale gap happened to still be running.

Blocking rematch does not close this on its own: it covers the buttons that chain a game,
not walking back to the lobby. So the content script reports the moment one of your games finishes,
and the gap starts from there. The stored end never moves backwards, so the archive can
only ever confirm it.

The counts have no such shortcut — a game is counted when the archive says so — so that
report also starts a chain of re-reads, at 4s, 8s, 15s, 30s and 60s, stopping the moment
the game appears. Between the two, the day is knowably short by exactly that game, and
both surfaces say so rather than showing a settled-looking number: the popup with
"Counting your last game…", and by asking again every three seconds while it is open.

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

## Languages

English, Spanish and Catalan — the three that can be checked by someone who reads them.
A machine translation nobody can verify is worse than English, which at least reads as a
language somebody wrote. The browser picks: extensions take their
language from the browser's own, so there is deliberately no language setting to get
wrong — and no way to override it either, which is the trade-off the platform imposes.

Every string lives in `src/locales/<lang>.yml`, `en.yml` being the source the others
translate. To add a language, copy it, translate the values, and add the code to
`TRANSLATIONS` in `src/locales/locales.test.ts` — which then holds the new file to the
English one: same keys, same `$1` substitutions, plurals still plural. That test exists
because a missing key is not an error anywhere else: `getMessage` answers `''`, the line
renders blank, and every other test passes because they all run in English.

Two things never get translated. The mode names — Bullet, Blitz and Rapid are what the
site itself shows, and players say them in every language. And clock times, which `Intl`
formats from the UI language; the catalogue only decides what wraps the result, which is
how `21:30h` stays Spanish without turning up on an English `4:00 PM`.

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
pnpm test          # 229 tests (vitest + happy-dom)
pnpm check         # types (svelte-check)
pnpm smoke         # builds, then drives the settings page in a real Chrome
pnpm screenshots   # builds, then re-renders the store screenshots from it
pnpm format        # prettier, configured to match what the code already used
pnpm format:check  # the same, read-only
pnpm icons         # regenerates public/icon/*.png with no external dependencies
```

`pnpm smoke` exists because of a bug the other checks all missed: the settings page passed
reactive state — a proxy — to `browser.storage`, which structured-clones and cannot clone
one. Every write rejected in the browser while the types checked out and the suite stayed
green, since the storage double kept whatever it was handed. The double now clones the way
the browser does (`src/test-setup.ts`), which is what the unit tests rely on; the smoke
check is what confirms that rule still matches a real browser.

It has since taken on the other two things only a browser can settle. That the settings
page still opens in the browser's dialog and not in a tab — `options_ui` is assembled from
the entrypoint, so the same key set in `wxt.config.ts` reads as deliberate and changes
nothing. And that the form still fits that dialog, which is 640px tall counting its own
title bar: the page is measured after rendering, in every language shipped, because what
decides its height is the text, and the translations run longer than the English.

`pnpm screenshots` re-renders `store/screenshots/1-popup.jpg` and `3-settings.jpg` from the
built bundle, which is the only way to capture either — a popup is not a page you can open,
and the settings live inside a dialog. Both went stale unnoticed once already. The third
image is the overlay running on the real site and is not made by a script.

Both need Chrome installed; the screenshots also need the network, for the avatar.
