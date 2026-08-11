import { i18n } from '#i18n';
import { isOff, type Decision } from '../core/policy';
import type { GameType } from '../core/types';
import { NAMES, formatTime } from '../ui/format';
// As text, not as a stylesheet: a page stylesheet cannot reach into a closed shadow root.
import buttonCss from '../ui/button.css?inline';

/**
 * The blocking screen. Lives in a shadow root so chess.com's styles cannot reach it and
 * ours cannot leak into the site.
 */

function minutesUntil(target: number, now: number): number {
  return Math.max(1, Math.ceil((target - now) / 60_000));
}

export type OverlayCopy = { title: string; body: string };

/** The blocking copy. Kept apart from the DOM so it can be tested without a browser. */
export function copyFor(decision: Decision, gameType: GameType, now: number): OverlayCopy | null {
  if (decision.allow) return null;

  // No other game type is ever mentioned. Saying "rapid is still available" mid-impulse
  // is an invitation to keep playing, not a consolation.
  if (decision.reason === 'quota') {
    if (isOff(decision.limit)) {
      return {
        title: i18n.t('overlay.quotaOff.title', [NAMES[gameType]]),
        body: i18n.t('overlay.quotaOff.body'),
      };
    }
    return {
      title: i18n.t('overlay.quota.title', [NAMES[gameType]]),
      body: i18n.t('overlay.quota.body', [decision.used, decision.limit]),
    };
  }

  // The time and the minutes go in as two substitutions rather than as one pre-built
  // fragment: every language puts them in its own order, and half a sentence cannot be
  // translated. Which is why the body carries the whole thing and not a tail.
  const at = formatTime(decision.until);
  const mins = minutesUntil(decision.until, now);

  if (decision.reason === 'tilt') {
    return {
      title: i18n.t('common.lossStreak', decision.losses),
      body: i18n.t('overlay.tilt.body', [at, mins]),
    };
  }

  return { title: i18n.t('overlay.gap.title'), body: i18n.t('overlay.gap.body', [at, mins]) };
}

/** Rematch is blocked always, quota or no quota, so its copy mentions no limit. */
export const REMATCH_COPY: OverlayCopy = {
  title: i18n.t('overlay.rematch.title'),
  body: i18n.t('overlay.rematch.body'),
};

/**
 * What to show when a button that chains another game is clicked, or `null` to let the
 * click through.
 *
 * A block covering every game type is reported ahead of the rematch rule, which reads the
 * wrong way round until you see what the copy says. "Go back to the lobby" is only true
 * advice while the lobby would let you in: inside the gap, or with every type spent, it
 * sends you to a door that is shut as well and withholds the one thing worth knowing —
 * when it opens. With one type spent but another free the lobby really is the way, and
 * that is the case this still answers.
 */
export function rematchCopy(input: {
  blockRematch: boolean;
  blanket: { decision: Decision; gameType: GameType } | null;
  now: number;
}): OverlayCopy | null {
  const { blockRematch, blanket, now } = input;
  if (blanket !== null) return copyFor(blanket.decision, blanket.gameType, now);
  return blockRematch ? REMATCH_COPY : null;
}

export const OVERLAY_CSS = `
  :host { all: initial; }

  /*
   * Everything is in \`em\` over an explicit base, never \`rem\`.
   *
   * \`rem\` resolves against the document root even inside a shadow root, and chess.com
   * sets \`html { font-size: 10px }\`. With \`rem\` this screen rendered at 62.5% of its
   * intended size.
   */
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(12, 14, 16, 0.82);
    backdrop-filter: blur(6px);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 16px;
  }
  .card {
    max-width: 34em; margin: 1.5em; padding: 3em 2.75em;
    border-radius: 0.9em; background: #262421; color: #f2f0ed;
    box-shadow: 0 1.5em 3em rgba(0, 0, 0, 0.45);
    text-align: center;
  }
  h1 { margin: 0 0 0.55em; font-size: 2.25em; line-height: 1.15; font-weight: 700; }
  p { margin: 0; font-size: 1.375em; line-height: 1.45; color: #d0cdc8; }

  ${buttonCss}
  /* Sizing only: the shared rules above carry the colour and the depth. */
  .cc-button { margin-top: 2.25em; padding: 0.75em 2.25em; font-size: 1.25em; }
`;

export type Overlay = { show: (copy: OverlayCopy) => void; hide: () => void };

/**
 * Creates the overlay (hidden) and returns the handles to drive it.
 *
 * It covers the whole viewport at the top of the stacking order, so it must be easy to
 * get out of: the button, Escape, or a click outside the card all dismiss it. One button
 * as the only way out would leave the page unusable if anything went wrong with it.
 *
 * The shadow root is closed on purpose. Dismissing is meant to be easy for you, not for a
 * script on the page reaching in to delete the thing.
 */
export function createOverlay(doc: Document): Overlay {
  const host = doc.createElement('div');
  host.style.display = 'none';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = doc.createElement('style');
  style.textContent = OVERLAY_CSS;

  const backdrop = doc.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  // Clicks inside the card must not count as clicking away from it.
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) hide();
  });

  const card = doc.createElement('div');
  card.className = 'card';

  const title = doc.createElement('h1');
  title.id = 'title';
  backdrop.setAttribute('aria-labelledby', title.id);
  const body = doc.createElement('p');

  const close = doc.createElement('button');
  close.className = 'cc-button';
  close.textContent = i18n.t('overlay.close');
  close.addEventListener('click', () => hide());

  card.append(title, body, close);
  backdrop.append(card);
  shadow.append(style, backdrop);

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') hide();
  }

  function show(copy: OverlayCopy): void {
    title.textContent = copy.title;
    body.textContent = copy.body;
    if (host.parentNode === null) doc.body.append(host);
    host.style.display = 'block';
    // Listening only while shown, so we leave nothing behind on the page.
    doc.addEventListener('keydown', onKeyDown);
    close.focus();
  }

  function hide(): void {
    host.style.display = 'none';
    doc.removeEventListener('keydown', onKeyDown);
  }

  return { show, hide };
}
