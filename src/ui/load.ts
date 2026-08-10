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
