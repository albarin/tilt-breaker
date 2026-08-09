# Chrome Web Store listing

Copy for the developer dashboard. Kept here so it changes with the code.

## Short description

Comes from the manifest (`wxt.config.ts`), 132-character limit:

> Daily game limits for chess.com, so extra blitz stops eating your rapid. Not affiliated with Chess.com.

## Detailed description

Tilt Breaker caps how many games you play on chess.com each day — and makes the cap hold
at the moment you least want it to.

**The rules**

- **A daily limit per game type.** Bullet, blitz and rapid each get their own count, so
  you can cap the one that hurts without touching the one you care about.
- **A mandatory gap between games.** Fifteen minutes by default, counted from your last
  game of any type — alternating bullet and blitz will not get you around it.
- **A stop after a losing streak.** Three losses in a row in one game type locks it for an
  hour. That is usually the stretch where the rating actually goes.
- **No rematches.** The rematch button is hidden always, quota or no quota. It is the
  button that turns one game into five before you have decided to play them; walking back
  to the lobby takes a few seconds, and those seconds are the decision.

**How it counts**

From chess.com's own public API, not by watching the page. So it knows the real game type
and result of every game, draws included, and it counts what you play on your phone too.

**What it will not do**

It never interrupts a game in progress — abandoning costs rating. It only blocks the
buttons that start a new one.

There is no "just this once" button, no observe-only mode, and no account to configure.
Any of the three would be a one-click way around the very thing you asked it to do. If you
need out, disable the extension: deliberately more work than a click.

**Privacy**

Everything is stored in your own browser. The only requests go to chess.com's public API,
with your own username, to count your games. Nothing is sent anywhere else and there is no
analytics of any kind.

Not affiliated with Chess.com.

## Permission justifications

The dashboard asks for one per permission.

| Permission | Justification |
| --- | --- |
| `storage` | Stores your limits and the day's game count locally. Nothing leaves the browser. |
| `alarms` | Refreshes the day's count every 30 minutes so the popup is current when opened. |
| `*://*.chess.com/*` | The content script reads which button you clicked in order to block starting a game over your limit, and reads the signed-in username from the page so you do not have to type it. |
| `https://api.chess.com/*` | Reads your public game archive to count today's games and their results. |

**Single purpose:** limit how many chess.com games the user plays per day.

**Remote code:** none. Everything executed ships in the package.
