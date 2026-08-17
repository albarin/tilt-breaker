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
 */
export const ASK_EVERY_MS = 3_000;
export const ASK_FOR_MS = 120_000;

/**
 * The view, kept current for as long as the popup is open.
 *
 * Asking once is not enough, and this is the bug it fixes: the archive publishes a game
 * seconds after it ends, so opening the popup right after playing gets an answer that
 * predates the game you just played — and it stayed on screen, wrong, until the popup was
 * closed and opened again. Now it asks again while you are looking.
 *
 * A failed ask never replaces what is already shown. `loadView` reports an unreachable
 * background as a view with no rows, which is honest for the first answer and destructive
 * for the fifth: the counts would blink away because one poll of many did not land.
 */
export function watchView(onView: (view: View) => void): {
  refresh: () => Promise<void>;
  stop: () => void;
} {
  let stopped = false;
  let showing = false;
  let asking = false;

  async function refresh(): Promise<void> {
    const view = await loadView();
    if (stopped) return;
    if (showing && view.problem === 'network-error' && view.rows.length === 0) return;
    showing = true;
    onView(view);
  }

  /**
   * One ask at a time.
   *
   * The interval does not wait for the answer, and an ask that outlives it — a slow
   * connection, a service worker still starting — used to have the next one fired on top
   * of it. That is a queue of requests for the same thing whose answers can land out of
   * order, the older one last, putting a count back on screen that the newer one had
   * already corrected.
   *
   * Only the interval is guarded. `refresh` stays unconditional: it is what a detected
   * account change calls, and that must never be the ask that gets dropped.
   */
  async function poll(): Promise<void> {
    if (asking) return;
    asking = true;
    try {
      await refresh();
    } finally {
      asking = false;
    }
  }

  const polling = setInterval(() => void poll(), ASK_EVERY_MS);
  const until = setTimeout(() => clearInterval(polling), ASK_FOR_MS);
  void poll();

  return {
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(polling);
      clearTimeout(until);
    },
  };
}
