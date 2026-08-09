import type { Decision } from '../core/policy';
import type { GameType } from '../core/types';
import { NAMES, formatTime } from '../ui/format';

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
    // A quota of 0 is not "spent", it is switched off. "0 of 0" would read as a bug.
    if (decision.limit === 0) {
      return {
        title: `No ${NAMES[gameType].toLowerCase()} today`,
        body: 'You have it set to zero. Come back tomorrow.',
      };
    }
    return {
      title: `That's your ${NAMES[gameType].toLowerCase()} for today`,
      body: `You have played ${decision.used} of ${decision.limit}. Come back tomorrow.`,
    };
  }

  const wait = `${formatTime(decision.until)}, ${minutesUntil(decision.until, now)} min from now.`;

  if (decision.reason === 'tilt') {
    return { title: `${decision.losses} losses in a row`, body: `Resting until ${wait}` };
  }

  return { title: 'One at a time', body: `You just played. Next game at ${wait}` };
}

/** Rematch is blocked always, quota or no quota, so its copy mentions no limit. */
export const REMATCH_COPY: OverlayCopy = {
  title: 'No rematches',
  body: 'This is the button that turns one game into five. If you really want another, go back to the lobby.',
};

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
  /*
   * chess.com's own primary button, measured off the live "Start Game": a vertical
   * gradient with a bright inset line on top and a dark one underneath, which is what
   * makes it read as raised rather than flat.
   */
  button {
    margin-top: 2.25em; padding: 0.75em 2.25em;
    border: 0; border-radius: 10px; cursor: pointer;
    background: linear-gradient(#81b64c 0%, #5d9948 100%);
    box-shadow:
      inset 0 1px 0 0 rgba(178, 224, 104, 0.4),
      inset 0 -1px 0 0 #45753c,
      inset 0 2px 4px 0 rgba(178, 224, 104, 0.5),
      inset 0 -2px 4px 0 rgba(69, 117, 60, 0.5),
      0 1px 2px 0 rgba(0, 0, 0, 0.14),
      0 2px 4px 0 rgba(0, 0, 0, 0.1);
    color: #fff; text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
    font-family: inherit; font-size: 1.25em; font-weight: 800;
  }
  button:hover { background: linear-gradient(#8cc056 0%, #67a350 100%); }
  button:active {
    background: linear-gradient(#75a544 0%, #548a40 100%);
    box-shadow:
      inset 0 1px 3px 0 rgba(0, 0, 0, 0.3),
      inset 0 -1px 0 0 rgba(178, 224, 104, 0.25);
  }
`;

export type Overlay = { show: (copy: OverlayCopy) => void; hide: () => void };

/** Creates the overlay (hidden) and returns the handles to drive it. */
export function createOverlay(doc: Document): Overlay {
  const host = doc.createElement('div');
  host.style.display = 'none';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = doc.createElement('style');
  style.textContent = OVERLAY_CSS;

  const backdrop = doc.createElement('div');
  backdrop.className = 'backdrop';

  const card = doc.createElement('div');
  card.className = 'card';

  const title = doc.createElement('h1');
  const body = doc.createElement('p');

  const close = doc.createElement('button');
  close.textContent = 'Got it';
  close.addEventListener('click', () => hide());

  card.append(title, body, close);
  backdrop.append(card);
  shadow.append(style, backdrop);

  function show(copy: OverlayCopy): void {
    title.textContent = copy.title;
    body.textContent = copy.body;
    if (host.parentNode === null) doc.body.append(host);
    host.style.display = 'block';
  }

  function hide(): void {
    host.style.display = 'none';
  }

  return { show, hide };
}
