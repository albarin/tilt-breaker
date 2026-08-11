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
 * Long enough to outlast the archive's own delay — a game shows up seconds after it ends —
 * and short enough that a popup left open is not polling all evening. Each repeat is a
 * conditional request the server answers 304 unless something changed.
 */
export const ASK_EVERY_MS = 3_000;
export const ASK_FOR_MS = 15_000;

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

  async function refresh(): Promise<void> {
    const view = await loadView();
    if (stopped) return;
    if (showing && view.problem === 'network-error' && view.rows.length === 0) return;
    showing = true;
    onView(view);
  }

  const asking = setInterval(() => void refresh(), ASK_EVERY_MS);
  const until = setTimeout(() => clearInterval(asking), ASK_FOR_MS);
  void refresh();

  return {
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(asking);
      clearTimeout(until);
    },
  };
}
