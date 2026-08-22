import { storage } from 'wxt/utils/storage';
import type { Totals } from '../api/chesscom-api';
import { dayKeyOf } from '../core/day';
import {
  DAY_RESET_HOUR,
  DEFAULT_SETTINGS,
  type GameRecord,
  type GameType,
  type Ratings,
  type Settings,
} from '../core/types';

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
  /**
   * The two marks `pendingOf` compares, from the last read where the profile answered.
   * Absent on a snapshot written before this and on the first sync of a day, which is the
   * same thing to every reader: no movement known, nothing pending.
   */
  counters?: Counters;
  /**
   * Games chess.com's own record counts that the archive has not published yet, per game
   * type. Stored rather than recomputed on demand because the profile read that produces
   * it can fail, and the last thing we knew is the safe thing to keep: forgetting a
   * pending game lifts a block, and inventing one never happens.
   */
  pending?: Partial<Record<GameType, number>>;
};

/**
 * What the archive has accounted for, against what chess.com's profile has counted.
 *
 * `reflected` is the profile's lifetime total per game type as of the games we hold;
 * `archived` is how many games those months held when we last read them. The pair only
 * means anything read together, over the same `months` — see `advance` in `state/sync.ts`.
 */
export type Counters = {
  /** The month keys these were taken over, joined: `'2026-08'`, `'2026-08,2026-09'`. */
  months: string;
  reflected: Totals;
  archived: Totals;
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
 * What the detected account is rated in each game type, whose ratings they are, and which
 * of the two places they came from.
 *
 * Carries the account for the reason the day snapshot does: signing in as someone else
 * must not leave their numbers beside your game types. The name is the whole check —
 * a stored rating is shown only while it still belongs to the account on screen.
 *
 * The two sources are kept apart rather than merged on the way in, because one of them is
 * always the better answer and neither writer can see the other's timing. `played` is the
 * rating the archive left you on, which arrives with the count it belongs to; `profile` is
 * what `/stats` says, read on a timer and only ever needed for a game type with no game in
 * the months we fetch. Merged into one field, a profile read that happened to land after a
 * game would put the older number back.
 *
 * Written only by a fetch that succeeded, so a lost connection leaves the last rating we
 * knew where it is instead of blanking a row that was right a minute ago. A value stored
 * by 1.3.0 in the older shape has neither field and reads as no ratings at all, which the
 * next sync — seconds away — fills in.
 */
export type StoredRatings = { username: string; played: Ratings; profile: Ratings };

const ratingsItem = storage.defineItem<StoredRatings | null>('local:ratings', {
  fallback: null,
});

export function getRatings(): Promise<StoredRatings | null> {
  return ratingsItem.getValue();
}

export function watchRatings(onChange: (ratings: StoredRatings | null) => void): () => void {
  return ratingsItem.watch(onChange);
}

/**
 * Records ratings from one of the two sources, keeping the other's.
 *
 * Merged per game type rather than replaced: a type missing from this answer is one the
 * source could not speak for — a month with no game of that type, a profile that does not
 * list it — and dropping the number we already had would blank a row over a silence.
 *
 * A different account replaces the lot. Serialised like every read-modify-write here: the
 * two sources write from different places and can land at once.
 */
export function rememberRatings(
  username: string,
  source: 'played' | 'profile',
  ratings: Ratings,
): Promise<void> {
  return serialize(async () => {
    const stored = await ratingsItem.getValue();
    const previous: StoredRatings =
      stored?.username === username ? stored : { username, played: {}, profile: {} };

    await ratingsItem.setValue({ ...previous, [source]: { ...previous[source], ...ratings } });
  });
}

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
 * Games the page has told us finished, that the archive has not published yet.
 *
 * Keyed by chess.com's own game id — the same key the archive files them under — so one
 * is retired the moment it appears there, by identity and not by comparing clocks. That
 * is what makes counting it provisionally safe: a game cannot be counted twice, because
 * both halves are the same key.
 *
 * Kept out of the day snapshot on purpose, though it is day-shaped. The snapshot is
 * rewritten wholesale by every sync, and these are written from a message that arrives in
 * the middle of one; sharing a record would make the two writers race for it.
 */
export type FinishedGame = { gameType: GameType; at: number };

const finishedItem = storage.defineItem<Record<string, FinishedGame>>('local:finished', {
  fallback: {},
});

export function getFinished(): Promise<Record<string, FinishedGame>> {
  return finishedItem.getValue();
}

/** Records a game the page saw end. Ignores one already recorded, so a retry is free. */
export function rememberFinishedGame(id: string, gameType: GameType): Promise<void> {
  return serialize(async () => {
    const stored = await finishedItem.getValue();
    if (stored[id] !== undefined) return;
    await finishedItem.setValue({ ...stored, [id]: { gameType, at: Date.now() } });
  });
}

/** Drops the ones that are done: published by the archive, or too old to still be coming. */
export function forgetFinished(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return serialize(async () => {
    const stored = await finishedItem.getValue();
    const next = Object.fromEntries(Object.entries(stored).filter(([id]) => !ids.includes(id)));
    await finishedItem.setValue(next);
  });
}

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
