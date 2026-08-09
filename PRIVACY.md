# Privacy policy

**Tilt Breaker collects nothing.** There is no server behind it, no account to create and
no analytics of any kind.

## What it stores, and where

In your browser's local extension storage, and nowhere else:

- Your settings: the daily limit per game type, minutes between games, the losing-streak
  threshold, and whether the rematch button is hidden.
- A cached count of today's games, so the popup can show it without querying again.
- The chess.com username read from your signed-in session, and your avatar URL, so you do
  not have to type the username in.

Uninstalling the extension removes all of it. None of it is ever transmitted to the
author.

## What leaves your browser

One kind of request, to chess.com and to no one else:

- `api.chess.com` — your own public game archive, to count today's games and their
  results, and your public profile, for the avatar. Your username is part of the URL,
  because that is how the endpoint identifies whose games to return.

This is chess.com's public API: the same data anyone can read about your account without
being signed in. It goes to the service you are already signed into, and to no third
party. There are no other network requests.

## What it reads on the page

The extension runs a script on chess.com pages, which reads only:

- Which element you clicked, in order to cancel clicks on the buttons that would start a
  game past the limit you set.
- The username shown in the sidebar of your signed-in session.

It does not read your games, your messages, your board, or anything else on the page, and
it sends nothing it reads anywhere.

## Permissions

- `storage` — the settings and cached count above.
- `alarms` — one 30-minute timer to refresh that count.
- `*://*.chess.com/*` — to run the script described above.
- `https://api.chess.com/*` — to read your public archive and profile.

## Contact

Open an issue at <https://github.com/albarin/tilt-breaker/issues>.

Not affiliated with Chess.com.
