import { sendMessage, type View } from '../messaging';

export type { View } from '../messaging';

/**
 * Everything the popup needs to render, in one call.
 *
 * Answered by the background rather than synced here: the storage write queue serialises
 * within one context only, and a popup-side sync raced the background's — a stale read
 * in the popup could rewind `lastGameEnd` past the never-backwards guard.
 *
 * Never rejects, like the sync it replaced: a dead background reads as a network problem.
 */
export async function loadView(): Promise<View> {
  try {
    const status = await sendMessage({ force: true, view: true });
    if (status.view !== undefined) return status.view;
  } catch {
    // The service worker may still be starting; fall through.
  }
  return { rows: [], problem: 'network-error' };
}

/**
 * How often the view is asked for again, and for how long.
 *
 * The window was fifteen seconds and that was a guess at how long chess.com takes to
 * publish a finished game. It takes as long as it takes, and giving up first put the popup
 * back to showing a day that was missing the game you opened it to see. Two minutes now:
 * longer than the wait has ever been, and still an end, because a popup nobody closed
 * should not poll all evening. Each repeat is a conditional request answered 304 unless
 * something changed.
 *
 * Both change while a game is on its way. The popup says so itself — "Counting your last
 * game…" — and that notice is the one moment where the difference between a second and
 * three is the difference between watching a number arrive and watching a stale one sit
 * there. The longer window is the archive's own outer edge: as long as the background is
 * still chasing the game, the screen showing the wait keeps asking too.
 */
export const ASK_EVERY_MS = 3_000;
export const ASK_FOR_MS = 120_000;
export const ASK_SETTLING_EVERY_MS = 1_000;
export const ASK_SETTLING_FOR_MS = 5 * 60_000;

/**
 * The view, kept current for as long as the popup is open.
 *
 * Asking once is not enough, and this is the bug it fixes: the archive publishes a game
 * seconds after it ends, so opening the popup right after playing gets an answer that
 * predates the game you just played — and it stayed on screen, wrong, until the popup was
 * closed and opened again. Now it asks again while you are looking.
 *
 * Each ask is scheduled from the end of the one before it rather than on an interval,
 * which is what keeps two of them from ever being in flight at once. That used to need a
 * guard: an interval does not wait for an answer, and on a slow connection it fired the
 * next ask on top of one still running — a queue of requests for the same thing whose
 * answers can land out of order, the older one last, putting a count back on screen that
 * the newer one had already corrected.
 *
 * A failed ask never replaces what is already shown. `loadView` reports an unreachable
 * background as a view with no rows, which is honest for the first answer and destructive
 * for the fifth: the counts would blink away because one poll of many did not land.
 */
export function watchView(onView: (view: View) => void): {
  refresh: () => Promise<void>;
  stop: () => void;
} {
  const startedAt = Date.now();
  let stopped = false;
  let showing = false;
  let settling = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function refresh(): Promise<void> {
    const view = await loadView();
    if (stopped) return;
    if (showing && view.problem === 'network-error' && view.rows.length === 0) return;
    showing = true;
    settling = view.settling === true;
    onView(view);
  }

  function schedule(): void {
    const every = settling ? ASK_SETTLING_EVERY_MS : ASK_EVERY_MS;
    const until = settling ? ASK_SETTLING_FOR_MS : ASK_FOR_MS;
    if (Date.now() - startedAt >= until) return;
    timer = setTimeout(() => void poll(), every);
  }

  async function poll(): Promise<void> {
    await refresh();
    if (stopped) return;
    schedule();
  }

  void poll();

  return {
    /**
     * Unscheduled, and deliberately outside the loop above: this is what a detected account
     * change calls, and it must never be the ask that waits its turn.
     */
    refresh,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
