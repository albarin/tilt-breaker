# Chrome Web Store listing

Copy for the developer dashboard. Kept here so it changes with the code.

## Short description

Comes from the manifest (`wxt.config.ts`), 132-character limit:

> Stop the one-more-game spiral on chess.com: daily caps per game type, a cooldown between games, no rematch.

## Detailed description

Paste as plain text. The dashboard does not render Markdown, so no asterisks or dashes
for emphasis — the field shows them literally.

```text
Tilt Breaker caps how many games you play on chess.com each day, and makes the cap hold at the moment you least want it to.

THE RULES

A daily limit per game type. Bullet, blitz and rapid each get their own count, so you can cap the one that hurts without touching the one you care about.

A mandatory gap between games. Fifteen minutes by default, counted from your last game of any type, so alternating bullet and blitz will not get you around it.

A stop after a losing streak. Three losses in a row in one game type locks it for an hour. That is usually the stretch where the rating actually goes.

No rematches. The rematch button is blocked always, quota or no quota. It is the button that turns one game into five before you have decided to play them, and walking back to the lobby takes a few seconds that are the decision itself.

HOW IT COUNTS

From chess.com's own public API, not by watching the page. So it knows the real game type and result of every game, draws included, and it counts what you play on your phone too.

WHAT IT WILL NOT DO

It never interrupts a game in progress, because abandoning costs rating. It only blocks the buttons that start a new one.

There is no "just this once" button, no observe-only mode and no account to configure. Any of the three would be a one-click way around the very thing you asked it to do. If you need out, disable the extension: deliberately more work than a click.

PRIVACY

Everything is stored in your own browser. The only requests go to chess.com's public API, with your own username, to count your games. Nothing is sent anywhere else and there is no analytics of any kind.

Not affiliated with Chess.com.
```

## Screenshots

In `store/screenshots/`, at the 1280×800 the dashboard wants. Suggested order:

1. **`1-popup.jpg`** — the popup over a real chess.com lobby: today's count per game type,
   blitz spent, and the wait until the next game. The page behind is dimmed so the popup
   reads as the subject; nothing in the interface is faked.
2. **`2-rematch-blocked.jpg`** — the blocking screen after a game, produced by the real
   overlay code running on a real chess.com page.
3. **`3-settings.jpg`** — everything that can be configured, which is little on purpose.

They were captured against the live site with the real markup and stylesheets, so they
will drift if the interface changes. Worth redoing before any submission that follows a
visual change.

## Privacy practices tab

Every field the dashboard blocks publication on. Paste as plain text.

### Single purpose

```text
Tilt Breaker limits how many games the user plays on chess.com per day. Everything it does serves that one purpose: counting the user's own games through chess.com's public API, and cancelling clicks on the buttons that would start another game past the limit the user set for themselves.
```

### storage

```text
Stores the user's own settings (daily limit per game type, minutes between games, losing-streak threshold, whether to block the rematch button) and a cached count of today's games so the popup can render without re-querying. Everything stays in chrome.storage.local and is never transmitted.
```

### alarms

```text
One periodic alarm, every 30 minutes, refreshes the cached count of today's games from chess.com's public API. Without it the popup would show stale numbers when opened with no chess.com tab in the browser.
```

### Host permission

```text
*://*.chess.com/* — a content script runs on the site to do two things: cancel clicks on the buttons that start a new game when the user is over the limit they set, and read the signed-in username from the page so the user does not have to type it into settings.

https://api.chess.com/* — reads the user's own public game archive to count today's games, their game type and their result. This is what the limits are counted from.

Neither is used to read, collect or transmit anything else.
```

### Remote code

Answer **No, I am not using remote code**, and justify:

```text
No remote code. Every line of JavaScript the extension runs ships inside the package. The network requests it makes fetch JSON data from chess.com's public API; nothing fetched is executed or evaluated.
```

### Data usage

Tick nothing in the data-collection list and certify the three statements. The extension
collects nothing: settings and counts stay in local storage, and the only request is to
chess.com's own public API with the user's own username.

If a reviewer questions the username leaving the browser, the answer is that it goes only
to chess.com — the same service the user is signed into and the one the extension exists
to work with — and to no third party.

## URLs

All three must resolve for an anonymous visitor, which is how the dashboard checks them.
A private repository answers 404 and fails all three, so the repository has to be public.

| Field          | URL                                                            |
| -------------- | -------------------------------------------------------------- |
| Homepage       | `https://github.com/albarin/tilt-breaker`                      |
| Support        | `https://github.com/albarin/tilt-breaker/issues`               |
| Privacy policy | `https://github.com/albarin/tilt-breaker/blob/main/PRIVACY.md` |

Check one before saving:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://github.com/albarin/tilt-breaker
```

`200` is good, `404` means it is still private.
