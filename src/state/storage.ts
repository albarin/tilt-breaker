import { storage } from 'wxt/utils/storage';
import { dayKeyOf } from '../core/day';
import { DAY_RESET_HOUR, DEFAULT_SETTINGS, type GameRecord, type Settings } from '../core/types';

/**
 * Snapshot of the API archive for the current day. Replaced wholesale on every sync: the
 * API is the source of truth, nothing accumulates here by hand.
 */
export type DaySnapshot = {
  dayKey: string;
  games: Record<string, GameRecord>;
  fetchedAt: number;
  /** Per-month stamps for conditional requests. */
  lastModified: Record<string, string>;
};

const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

const snapshotItem = storage.defineItem<DaySnapshot | null>('local:daySnapshot', {
  fallback: null,
});

/**
 * End of the most recent game we have ever seen, across days.
 *
 * Stored apart from the day snapshot, which resets at midnight: the gap between games has
 * to hold at 00:05 for a game that ended at 23:58.
 */
export const lastGameEndItem = storage.defineItem<number | null>('local:lastGameEnd', {
  fallback: null,
});

/**
 * The account read from the chess.com session. Persisted so the popup and the refresh
 * alarm keep working with no chess.com tab open.
 */
export const detectedUsernameItem = storage.defineItem<string | null>('local:detectedUsername', {
  fallback: null,
});

/**
 * Serialises writes.
 *
 * Several chess.com tabs can talk to the background at once, and a `get` followed by a
 * `set` with an `await` in between is easy to interleave.
 */
let queue: Promise<unknown> = Promise.resolve();

export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export async function getSettings(): Promise<Settings> {
  // `fallback` does not fill in missing keys *inside* the object, so merge by hand: if we
  // add a setting later, existing installs inherit it instead of getting `undefined`.
  const stored = await settingsItem.getValue();
  return { ...DEFAULT_SETTINGS, ...stored, tilt: { ...DEFAULT_SETTINGS.tilt, ...stored?.tilt } };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(merged);
  return merged;
}

/** The stored snapshot, or `null` if there is none or it belongs to another day. */
export async function getSnapshot(now: number): Promise<DaySnapshot | null> {
  const stored = await snapshotItem.getValue();
  if (stored === null) return null;
  return stored.dayKey === dayKeyOf(now, DAY_RESET_HOUR) ? stored : null;
}

export function setSnapshot(snapshot: DaySnapshot): Promise<void> {
  return snapshotItem.setValue(snapshot);
}

/** Records the signed-in account. Returns `true` if it differs from the previous one. */
export async function rememberDetectedUsername(username: string): Promise<boolean> {
  const previous = await detectedUsernameItem.getValue();
  if (previous === username) return false;
  await detectedUsernameItem.setValue(username);
  return true;
}

/** Records a game end, never going backwards. */
export async function rememberLastGameEnd(endedAt: number | null): Promise<number | null> {
  const previous = await lastGameEndItem.getValue();
  if (endedAt === null || (previous !== null && previous >= endedAt)) return previous;
  await lastGameEndItem.setValue(endedAt);
  return endedAt;
}
