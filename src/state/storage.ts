import { storage } from 'wxt/utils/storage';
import { dayKeyOf } from '../core/day';
import { DAY_RESET_HOUR, DEFAULT_SETTINGS, type GameRecord, type Settings } from '../core/types';

/**
 * Snapshot of the API archive for the current day. Replaced wholesale on every sync: the
 * API is the source of truth, nothing accumulates here by hand.
 */
export type DaySnapshot = {
  dayKey: string;
  /**
   * The account the games belong to. A different sign-in invalidates the snapshot,
   * stamps included: sending the old account's ETag against the new account's archive
   * can 304 and keep counting games the new account never played.
   */
  username: string;
  games: Record<string, GameRecord>;
  fetchedAt: number;
  /**
   * Per-month `ETag`s for conditional requests.
   *
   * Snapshots written before this held `Last-Modified` stamps under another key. Nothing
   * migrates them: a missing ETag is one unconditional request, after which the snapshot
   * is in the new shape.
   */
  etags: Record<string, string>;
};

const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

const snapshotItem = storage.defineItem<DaySnapshot | null>('local:daySnapshot', {
  fallback: null,
});

/** Avatar of the detected account. Purely decorative, so it may well be `null`. */
export const avatarItem = storage.defineItem<string | null>('local:avatar', { fallback: null });

/**
 * End of the most recent game we have ever seen, across days.
 *
 * Stored apart from the day snapshot, which resets at midnight: the gap between games has
 * to hold at 00:05 for a game that ended at 23:58.
 *
 * Deliberately not per account, unlike the snapshot: the gap is rest for the person, and
 * switching accounts to dodge it is exactly the move it exists to stop.
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
 * Serialises writes. Every read-modify-write in this file goes through it.
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
  //
  // `limits` is merged per key like `tilt`, not taken wholesale. A game type added in a
  // later version would otherwise read as `undefined` on existing installs, and an
  // undefined limit is neither "no limit" nor a number: it blocks the type outright and
  // renders as "0 of undefined". A deliberate `null` still means no limit and survives.
  const stored = await settingsItem.getValue();
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    limits: { ...DEFAULT_SETTINGS.limits, ...stored?.limits },
    tilt: { ...DEFAULT_SETTINGS.tilt, ...stored?.tilt },
  };
}

/**
 * Plain data, whatever the caller handed us.
 *
 * `browser.storage` structured-clones what it is given, and a structured clone refuses a
 * proxy — which is exactly what the settings page holds, its state being reactive. The
 * write then rejects and the page is left believing it saved. Settings are plain JSON
 * data, so a round trip is both the check and the repair, and it happens here because
 * this is the one door to storage.
 */
function plainData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return serialize(async () => {
    const merged = plainData({ ...(await getSettings()), ...patch });
    await settingsItem.setValue(merged);
    return merged;
  });
}

/** Fires when the settings change, and only then. */
export function watchSettings(onChange: () => void): () => void {
  return settingsItem.watch(() => onChange());
}

/** The stored snapshot, or `null` if there is none or it belongs to another day or account. */
export async function getSnapshot(
  now: number,
  username: string | null,
): Promise<DaySnapshot | null> {
  const stored = await snapshotItem.getValue();
  if (stored === null || stored.username !== username) return null;
  return stored.dayKey === dayKeyOf(now, DAY_RESET_HOUR) ? stored : null;
}

export function setSnapshot(snapshot: DaySnapshot): Promise<void> {
  return snapshotItem.setValue(snapshot);
}

/** Records the signed-in account. Returns `true` if it differs from the previous one. */
export function rememberDetectedUsername(username: string): Promise<boolean> {
  return serialize(async () => {
    const previous = await detectedUsernameItem.getValue();
    if (previous === username) return false;
    await detectedUsernameItem.setValue(username);
    return true;
  });
}

/**
 * Records a game end, never going backwards.
 *
 * Serialised like every other read-modify-write here: several chess.com tabs sync at
 * once, and an unguarded pair would let the later write lose to the earlier one.
 */
export function rememberLastGameEnd(endedAt: number | null): Promise<number | null> {
  return serialize(async () => {
    const previous = await lastGameEndItem.getValue();
    if (endedAt === null || (previous !== null && previous >= endedAt)) return previous;
    await lastGameEndItem.setValue(endedAt);
    return endedAt;
  });
}
