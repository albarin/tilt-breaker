/**
 * Everything this extension knows about chess.com's DOM lives here. No other file knows
 * the site: when chess.com changes, this is the only file to touch.
 *
 * Counts do **not** come from here. They come from chess.com's public archive, which
 * knows the real game type and result. The page is only read for what the API cannot
 * tell us: which button you just clicked.
 *
 * Every selector below was confirmed against the live site with real games.
 *
 * House rule: prefer semantic attributes (`data-glyph`) and domain classes
 * (`time-selector-button-button`) over design-system ones, which carry a hash and rotate:
 * `cc-icon-glyph_75e61c9`. Never select on a hashed `cc-*`.
 */

import { parseGameId } from '../core/games';
import { classify, gameTypeFromLabel } from '../core/gametype';
import type { GameType } from '../core/types';

export const SEL = {
  /** The time-control picker on /play/online. */
  timeSelector: '.time-selector-next-component',
  /**
   * The dropdown groups options by game type, and each group carries its icon: Bullet,
   * Blitz, Rapid and Daily. The most reliable way to classify an option, since it depends
   * on neither the language nor parsing the time control.
   */
  timeSelectorSection: '.time-selector-section-component',
  /** One dropdown option: `"1 min"`, `"3 + 2"`, `"1 day"`. */
  timeSelectorOption: '.time-selector-button-button',
  /** The icon spells out the game type: `game-time-blitz`. */
  timeGlyph: '[data-glyph^="game-time-"]',
  /**
   * The "Start Game" button has no class of its own, only hashed design-system ones. Its
   * container does, and it is stable.
   */
  startGame: '.new-game-primary',
  /**
   * Quick-start links, which pair you straight away without going through the lobby: the
   * "Play 3 min" button on the home page, and anywhere else chess.com puts one.
   *
   * Matched on the href rather than on where it sits, so every copy of it is covered.
   * "Play a Friend" (/play/online/friend) does not match, and neither does the plain
   * "Play Online" link, which only opens the lobby we already guard.
   */
  quickPlay: 'a[href*="/play/online/new"]',
  /** The game-over modal, buttons included. */
  gameOverShell: '[class*="game-over-modal-shell-container"]',
  /**
   * The modal's close X, which is also a `<button>`. It must always get through:
   * blocking it would strand the modal on screen with no way to dismiss it.
   */
  gameOverClose: '[class*="game-over-modal-header-close"]',
  /**
   * Your own profile link, in the sidebar nav. This is what lets us know which account
   * you are signed in as without you typing it.
   *
   * It matters that it is *inside the sidebar*: the `/member/` links around the board
   * belong to your opponent.
   */
  ownProfileLink: '#sidebar-main-menu a[href*="/member/"]',
} as const;

/**
 * The id of the game being played, from the URL.
 *
 * The same parser that reads ids out of archive URLs: the two shapes of a game
 * (`/game/172719499530` while you play it, `/game/live/172348397066` in the archive) are
 * one grammar, and a second copy of it here would drift the day chess.com adds a third.
 */
export function gameIdFromPath(pathname: string): string | null {
  return parseGameId(pathname);
}

/**
 * Is the game-over modal on screen?
 *
 * Used to tell that the game you were playing has just finished — and, when it is already
 * there the moment you arrive, that this is a game you opened to review rather than play.
 */
export function hasGameOverModal(root: ParentNode): boolean {
  return root.querySelector(SEL.gameOverShell) !== null;
}

/** The game type chess.com writes into its icons. `game-time-daily` is not limited. */
function gameTypeFromGlyph(glyph: string | null | undefined): GameType | null {
  switch (glyph) {
    case 'game-time-bullet':
      return 'bullet';
    case 'game-time-blitz':
      return 'blitz';
    case 'game-time-rapid':
      return 'rapid';
    default:
      return null;
  }
}

/**
 * The game type of a quick-start link, read from its query string.
 *
 * chess.com puts the time control right in the URL — `base=180&timeIncrement=0` — in
 * **seconds**, which is exactly what `classify` takes. Far steadier than parsing the
 * "Play 3 min" label.
 */
export function gameTypeFromQuickPlay(href: string | null | undefined): GameType | null {
  const query = href?.split('?')[1];
  if (query === undefined) return null;
  const params = new URLSearchParams(query);
  const base = Number(params.get('base'));
  if (!Number.isFinite(base) || base <= 0) return null;
  const increment = Number(params.get('timeIncrement'));
  return classify({ base, increment: Number.isFinite(increment) ? increment : 0 });
}

/** The game type currently selected in the lobby. */
export function readSelectedGameType(root: ParentNode): GameType | null {
  const glyph = root.querySelector(`${SEL.timeSelector} ${SEL.timeGlyph}`);
  return gameTypeFromGlyph(glyph?.getAttribute('data-glyph'));
}

/**
 * The game type of a dropdown option.
 *
 * The enclosing section is asked first, because it carries the time-class icon: that is
 * what chess.com says, not what we deduce from the text. Only without a section do we
 * fall back to reading the label.
 *
 * `null` can mean two things, and for blocking purposes they are the same: it is
 * correspondence (Daily, never limited) or we could not read it.
 */
export function gameTypeOfOption(option: Element): GameType | null {
  const section = option.closest(SEL.timeSelectorSection);
  const glyph = section?.querySelector(SEL.timeGlyph)?.getAttribute('data-glyph');

  // The section wins. If it says Daily we do not try the text: `"1 day"` is no live time
  // control however much it starts with a number.
  if (glyph !== undefined && glyph !== null) return gameTypeFromGlyph(glyph);

  return gameTypeFromLabel(option.textContent);
}

/** What was clicked, from the blocking point of view. */
export type ClickTarget =
  /** A specific option. `gameType` null means correspondence or unreadable: no block. */
  | { kind: 'lobbyOption'; gameType: GameType | null }
  /** The dropdown itself: opening or closing it starts nothing. */
  | { kind: 'timeSelector' }
  /** "Start Game": applies to whichever game type is selected. */
  | { kind: 'startGame' }
  /** A quick-start link that pairs immediately, skipping the lobby. */
  | { kind: 'quickPlay'; gameType: GameType | null }
  /** "Rematch" or "New N min": chaining another game without leaving the modal. */
  | { kind: 'rematch' }
  | { kind: 'other' };

/**
 * Order matters: the option check comes before the selector one, and the selector before
 * "Start Game", because the selector lives *inside* the new-game panel. Without that
 * order, picking a Daily option would read as pressing "Start Game" and get blocked using
 * whichever game type happened to be selected before.
 *
 * Inside the modal only "Rematch" and "New N min" are in the way, both `<button>`. Links
 * ("Game Review", analysis) get through — reviewing a game is not playing another — and
 * so does the close X, or the modal would be stuck on screen.
 */
export function classifyClick(target: EventTarget | null): ClickTarget {
  if (!(target instanceof Element)) return { kind: 'other' };

  const option = target.closest(SEL.timeSelectorOption);
  if (option !== null) return { kind: 'lobbyOption', gameType: gameTypeOfOption(option) };

  if (target.closest(SEL.timeSelector) !== null) return { kind: 'timeSelector' };
  if (target.closest(SEL.startGame) !== null) return { kind: 'startGame' };

  const quick = target.closest(SEL.quickPlay);
  if (quick !== null) {
    return { kind: 'quickPlay', gameType: gameTypeFromQuickPlay(quick.getAttribute('href')) };
  }

  if (
    target.closest(SEL.gameOverShell) !== null &&
    target.closest('button') !== null &&
    target.closest(SEL.gameOverClose) === null
  ) {
    return { kind: 'rematch' };
  }
  return { kind: 'other' };
}

/**
 * The rematch buttons currently on screen, so they can be hidden.
 *
 * Cancelling the click is not enough: seeing the button already fires the impulse even
 * when it does nothing. Absent beats told-no.
 */
export function findRematchButtons(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(`${SEL.gameOverShell} button`)).filter(
    (button) => classifyClick(button).kind === 'rematch',
  );
}

/**
 * The account you are signed in as, read from the sidebar.
 *
 * Verified on the home page, in the lobby and inside a game: it is always there, and it
 * is always yours. Returns `null` when signed out.
 */
export function readOwnUsername(root: ParentNode): string | null {
  const href = root.querySelector(SEL.ownProfileLink)?.getAttribute('href') ?? '';
  const name = /\/member\/([^/?#]+)/.exec(href)?.[1];
  return name === undefined ? null : decodeURIComponent(name);
}
