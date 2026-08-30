import type { Decision } from '../core/policy';
import { GAME_TYPES, type GameType } from '../core/types';
import { sendMessage } from '../messaging';
import { getSettings, lastGameEndItem, watchSettings } from '../state/storage';
import {
  SEL,
  classifyClick,
  findRematchButtons,
  findResignButtons,
  gameIdFromPath,
  gameTypeFromQuickPlay,
  gameTypeOfOption,
  hasGameOverModal,
  readFinishedGameType,
  readOwnUsername,
  readSelectedGameType,
} from '../site/chesscom';
import { copyFor, createOverlay, rematchCopy, type OverlayCopy } from '../site/overlay';

const POLL_MS = 400;
const STATUS_REFRESH_MS = 15_000;
/**
 * How long a game page gets to finish rendering. The script runs at document_start, so
 * early ticks see an empty document no matter what the page will end up showing; only
 * after this settle time does the presence or absence of the modal mean anything.
 */
const SETTLE_MS = 5_000;
/**
 * Marks every control this extension refuses, and the only such mark there is.
 *
 * One treatment for all of them: greyed out and still there. Hiding was tried for the
 * rematch button on the grounds that absent beats told-no, but two treatments meant the
 * same refusal looked like two different things depending on which button you reached
 * for — and a button that vanishes from a panel you are still using reads as the page
 * breaking rather than as a rule. Greyed out says who did it and why.
 */
const BLOCKED_ATTR = 'data-tilt-breaker-blocked';
/**
 * Marks the resign button when you have asked for it to be gone.
 *
 * The one thing this extension hides rather than greys, and a separate mark because it is
 * a separate thing: nothing above is being refused. You turned the button off, so it is
 * off — greying it would be the extension answering a click you never wanted to make.
 */
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
 */
export default defineContentScript({
  matches: ['*://*.chess.com/*'],
  runAt: 'document_start',

  main(ctx) {
    let lastPath = '';
    /** The game on screen, and whether we have already reported it finishing. */
    let watchedGame: string | null = null;
    let watchStartedAt = 0;
    /** The watched game has been seen settled and modal-free: it was live, not a replay. */
    let seenLive = false;
    const reported = new Set<string>();
    const reviewing = new Set<string>();
    /** A report is in flight; without this every tick would send another. */
    let reporting = false;
    let decisions: Partial<Record<GameType, Decision>> = {};
    let blockRematch = false;
    let hideResign = false;

    const overlay = createOverlay(document);
    injectStyle();

    // Capture phase: this runs before chess.com's own handlers no matter how its UI is
    // wired, so the click can be cancelled without depending on their setup. Registered
    // through `ctx` so an extension reload takes it down with everything else — a stray
    // listener would outlive the intervals and keep blocking on frozen decisions.
    ctx.addEventListener(document, 'click', onClickCapture, { capture: true });

    void refreshStatus();
    void refreshSettings();
    ctx.setInterval(() => void refreshStatus(), STATUS_REFRESH_MS);
    ctx.setInterval(tick, POLL_MS);
    tick();

    /*
     * Two keys, not every storage write. Reacting to all of them meant reacting to the day
     * snapshot that our own request had just caused, costing an extra round trip after
     * every sync.
     *
     * `lastGameEnd` is what makes a second tab honest: a game finishing in one tab starts
     * a gap the others know nothing about until their next poll, which is long enough to
     * click "Start Game" in a lobby that was already open. It only changes when a game
     * actually ends, so there is no loop to fall into.
     */
    watchSettings(() => {
      void refreshStatus(true);
      void refreshSettings();
    });
    lastGameEndItem.watch(() => void refreshStatus(true));

    function injectStyle(): void {
      const style = document.createElement('style');
      style.textContent = CSS;
      (document.head ?? document.documentElement).append(style);
    }

    /** `false` if the background could not be reached, so the caller can try again. */
    async function refreshStatus(
      force = false,
      gameEnded = false,
      finished?: { id: string; gameType: GameType },
    ): Promise<boolean> {
      try {
        // The signed-in account rides along on every request: that is how the background
        // knows which user to count without anyone typing it into settings.
        const status = await sendMessage({
          force,
          username: readOwnUsername(document),
          ...(gameEnded ? { gameEnded } : {}),
          ...(finished === undefined ? {} : { finished }),
        });
        decisions = status.decisions;
        blockRematch = status.blockRematch;
        return true;
      } catch (error) {
        // The service worker may still be starting. When in doubt, block nothing.
        log('could not read status', error);
        decisions = {};
        blockRematch = false;
        return false;
      }
    }

    /**
     * Reads the settings the page enforces on its own.
     *
     * Hiding the resign button is a preference and not a decision: nothing is counted or
     * judged to know it, so it is read straight from storage rather than asked of the
     * background. That also keeps it honest when the background cannot be reached — a
     * button you asked to be rid of should not come back because a fetch failed.
     */
    async function refreshSettings(): Promise<void> {
      hideResign = (await getSettings()).hideResign;
    }

    function blockedReason(gameType: GameType | null): Extract<Decision, { allow: false }> | null {
      if (gameType === null) return null;
      const decision = decisions[gameType];
      return decision !== undefined && !decision.allow ? decision : null;
    }

    /**
     * A block covering every game type, so it holds whatever game gets started next.
     *
     * What a plain "Rematch" falls back to: it chains a game of the type just played and
     * the page does not name it, so this is the only block enforceable there without
     * guessing. A button that *does* name its game is judged on that game instead.
     * Prefers the gap, the block that is global by design.
     */
    function blanketBlock(): { gameType: GameType; decision: Decision } | null {
      const blocks: { gameType: GameType; decision: Extract<Decision, { allow: false }> }[] = [];
      for (const gameType of GAME_TYPES) {
        const decision = blockedReason(gameType);
        if (decision === null) return null;
        blocks.push({ gameType, decision });
      }
      return blocks.find(({ decision }) => decision.reason === 'gap') ?? blocks[0]!;
    }

    function block(event: Event, copy: OverlayCopy | null, reason: unknown): void {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (copy !== null) overlay.show(copy);
      log('blocked:', reason);
    }

    /**
     * Cancels the click if that game type is spent. A `null` game type is correspondence
     * or something we could not read, and never blocks.
     */
    function blockIfSpent(event: MouseEvent, gameType: GameType | null): void {
      const decision = blockedReason(gameType);
      if (decision === null || gameType === null) return;
      block(event, copyFor(decision, gameType, Date.now()), decision);
    }

    function onClickCapture(event: MouseEvent): void {
      const click = classifyClick(event.target);

      switch (click.kind) {
        // A lobby option names its own game type; a quick-start link carries it in the
        // href. Either way it is the type about to be played.
        case 'lobbyOption':
        case 'quickPlay':
          return blockIfSpent(event, click.gameType);

        // "Start Game" plays whatever the lobby currently has selected.
        case 'startGame':
          return blockIfSpent(event, readSelectedGameType(document));

        // Refused by the rematch rule, by a block covering every game type, or by both —
        // `rematchCopy` owns which of the two gets to explain itself.
        case 'rematch': {
          /*
           * The game the button names beats the blanket, and it is the whole of why the
           * game type is carried here: on a rapid "New Game" the blanket reports whichever
           * spent type comes first, which put "your Bullet is done for today" over a rapid
           * button. Named and free, nothing here blocks — `blanketBlock` cannot be holding
           * either, since that would mean the named type was spent too.
           */
          const named = click.gameType === null ? null : blockedReason(click.gameType);
          const blocked =
            click.gameType !== null && named !== null
              ? { gameType: click.gameType, decision: named }
              : blanketBlock();

          const copy = rematchCopy({ blockRematch, blocked, now: Date.now() });
          if (copy !== null) block(event, copy, blocked?.decision ?? 'rematch');
          return;
        }

        // Opening the dropdown starts no game, and neither does anything else.
        case 'timeSelector':
        case 'other':
          return;
      }
    }

    /** Greys out everything currently refused. The click interceptor is the real
     * enforcement; this only stops the UI from looking usable when it is not. */
    function paint(): void {
      const grey = (selector: string, typeOf: (el: Element) => GameType | null) => {
        for (const el of document.querySelectorAll(selector)) {
          el.toggleAttribute(BLOCKED_ATTR, blockedReason(typeOf(el)) !== null);
        }
      };
      grey(SEL.timeSelectorOption, gameTypeOfOption);
      grey(SEL.quickPlay, (el) => gameTypeFromQuickPlay(el.getAttribute('href')));

      // Refused either by the rematch rule or by a block that covers every game type —
      // the same two cases the click interceptor answers, painted the same way.
      // Judged one by one, and by the same rule the click gets: a button that names a
      // spent game type is refused while the others on the same panel are not.
      for (const button of findResignButtons(document)) {
        button.toggleAttribute(HIDDEN_ATTR, hideResign);
      }

      const refusedAlways = blockRematch || blanketBlock() !== null;
      for (const button of findRematchButtons(document)) {
        const click = classifyClick(button);
        const named =
          click.kind === 'rematch' && click.gameType !== null
            ? blockedReason(click.gameType)
            : null;
        button.toggleAttribute(BLOCKED_ATTR, refusedAlways || named !== null);
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
      watchGameEnd();
    }

    /**
     * Reports the moment one of your games finishes.
     *
     * The gap between games cannot wait for the archive: it takes a few seconds to
     * publish a game, and until it does the gap is measured from the *previous* one. After
     * a long game that is already expired, so nothing blocks and you can start another
     * straight away. Short games hid this, because the previous one was recent enough that
     * the stale gap happened to still be running.
     *
     * A finished game opened to review also shows the modal — but it shows it as soon as
     * the page renders. So the modal only counts as an ending after the game has been
     * seen live first: settled, on screen, and modal-free. Sampling on the first tick
     * instead would race the renderer, and a review misread as an ending starts a gap
     * that `rememberLastGameEnd` never walks back.
     *
     * The report is only marked delivered once the background has answered. A dropped
     * message — a service worker that died mid-send — would otherwise leave the gap
     * measured from the previous game, the very hole this exists to close.
     */
    function watchGameEnd(): void {
      const id = gameIdFromPath(location.pathname);
      if (id === null || reviewing.has(id) || reported.has(id) || reporting) return;

      if (watchedGame !== id) {
        watchedGame = id;
        watchStartedAt = Date.now();
        seenLive = false;
        return;
      }

      if (Date.now() - watchStartedAt < SETTLE_MS) return;

      if (!hasGameOverModal(document)) {
        seenLive = true;
        return;
      }

      if (!seenLive) {
        reviewing.add(id);
        return;
      }

      // Read while the modal is still up, which is the only moment it can be read.
      const gameType = readFinishedGameType(document);

      reporting = true;
      void refreshStatus(true, true, gameType === null ? undefined : { id, gameType }).then(
        (delivered) => {
          reporting = false;
          if (!delivered) return; // the next tick tries again
          reported.add(id);
          log('game finished:', id);
        },
      );
    }
  },
});

function log(...args: unknown[]): void {
  console.info('[tilt-breaker]', ...args);
}
