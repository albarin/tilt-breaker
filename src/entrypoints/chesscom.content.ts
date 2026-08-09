import type { Decision } from '../core/policy';
import type { GameType } from '../core/types';
import { sendMessage } from '../messaging';
import {
  SEL,
  classifyClick,
  findRematchButtons,
  gameTypeFromQuickPlay,
  readOwnUsername,
  readSelectedGameType,
  gameTypeOfOption,
} from '../site/chesscom';
import { REMATCH_COPY, copyFor, createOverlay, type OverlayCopy } from '../site/overlay';

const POLL_MS = 400;
const STATUS_REFRESH_MS = 15_000;
/** Marks controls the stylesheet should grey out. */
const BLOCKED_ATTR = 'data-tilt-breaker-blocked';
/** Marks what should not even be visible. */
const HIDDEN_ATTR = 'data-tilt-breaker-hidden';

const CSS = `
  [${BLOCKED_ATTR}] {
    opacity: 0.4 !important;
    filter: grayscale(1) !important;
    cursor: not-allowed !important;
  }
  [${HIDDEN_ATTR}] {
    display: none !important;
  }
`;

/**
 * The content script neither counts games nor reads results: the API does that. All it
 * does here is enforce the block on the buttons that start a new game.
 *
 * Because rematch is always blocked, the only way to chain another game is walking back
 * to the lobby — and that navigation takes far longer than the API needs to learn about
 * the game you just finished. So nothing has to be tracked.
 */
export default defineContentScript({
  matches: ['*://*.chess.com/*'],
  runAt: 'document_start',

  main(ctx) {
    let lastPath = '';
    let decisions: Partial<Record<GameType, Decision>> = {};
    let blockRematch = false;

    const overlay = createOverlay(document);
    injectStyle();

    // Capture phase: this runs before chess.com's own handlers no matter how its UI is
    // wired, so the click can be cancelled without depending on their setup.
    document.addEventListener('click', onClickCapture, true);

    void refreshStatus();
    ctx.setInterval(() => void refreshStatus(), STATUS_REFRESH_MS);
    ctx.setInterval(tick, POLL_MS);
    tick();

    // The quota changes when settings are edited from the popup.
    browser.storage.local.onChanged.addListener(() => void refreshStatus());

    function injectStyle(): void {
      const style = document.createElement('style');
      style.textContent = CSS;
      (document.head ?? document.documentElement).append(style);
    }

    async function refreshStatus(force = false): Promise<void> {
      try {
        // The signed-in account rides along on every request: that is how the background
        // knows which user to count without anyone typing it into settings.
        const status = await sendMessage({ force, username: readOwnUsername(document) });
        decisions = status.decisions;
        blockRematch = status.blockRematch;
      } catch (error) {
        // The service worker may still be starting. When in doubt, block nothing.
        log('could not read status', error);
        decisions = {};
        blockRematch = false;
      }
    }

    function blockedReason(gameType: GameType | null): Decision | null {
      if (gameType === null) return null;
      const decision = decisions[gameType];
      return decision !== undefined && !decision.allow ? decision : null;
    }

    function block(event: Event, copy: OverlayCopy | null, reason: unknown): void {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (copy !== null) overlay.show(copy);
      log('blocked:', reason);
    }

    function onClickCapture(event: MouseEvent): void {
      const click = classifyClick(event.target);

      switch (click.kind) {
        // Correspondence or unreadable: never blocked.
        case 'lobbyOption': {
          if (click.gameType === null) return;
          const decision = blockedReason(click.gameType);
          if (decision !== null) {
            block(event, copyFor(decision, click.gameType, Date.now()), decision);
          }
          return;
        }

        // Opening or closing the dropdown starts no game.
        case 'timeSelector':
          return;

        // Pairs immediately from outside the lobby, so it needs the same guard.
        case 'quickPlay': {
          if (click.gameType === null) return;
          const decision = blockedReason(click.gameType);
          if (decision !== null) {
            block(event, copyFor(decision, click.gameType, Date.now()), decision);
          }
          return;
        }

        case 'startGame': {
          const selected = readSelectedGameType(document);
          const decision = blockedReason(selected);
          if (decision !== null && selected !== null) {
            block(event, copyFor(decision, selected, Date.now()), decision);
          }
          return;
        }

        // Blocked always and on purpose, quota or no quota.
        case 'rematch': {
          if (blockRematch) block(event, REMATCH_COPY, 'rematch');
          return;
        }

        case 'other':
          return;
      }
    }

    /** Greys out blocked options and hides rematch. The click interceptor is the real
     * enforcement; this only stops the UI from looking usable when it is not. */
    function paint(): void {
      for (const option of document.querySelectorAll(SEL.timeSelectorOption)) {
        const gameType = gameTypeOfOption(option);
        option.toggleAttribute(BLOCKED_ATTR, gameType !== null && blockedReason(gameType) !== null);
      }
      for (const link of document.querySelectorAll(SEL.quickPlay)) {
        const gameType = gameTypeFromQuickPlay(link.getAttribute('href'));
        link.toggleAttribute(BLOCKED_ATTR, gameType !== null && blockedReason(gameType) !== null);
      }
      for (const button of findRematchButtons(document)) {
        button.toggleAttribute(HIDDEN_ATTR, blockRematch);
      }
    }

    function tick(): void {
      // chess.com is a SPA: there are no reloads to hook, so the path is compared. On a
      // page change we re-query without waiting for the TTL, which is how the count is
      // current by the time you reach the lobby.
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        void refreshStatus(true);
      }
      paint();
    }
  },
});

function log(...args: unknown[]): void {
  console.info('[tilt-breaker]', ...args);
}
