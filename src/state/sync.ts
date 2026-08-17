import { fetchGamesCovering, type Fetcher } from '../api/chesscom-api';
import { dayEndMs, dayKeyOf, dayStartMs } from '../core/day';
import { gamesForDay, lastGameEnd, toRecords } from '../core/games';
import { DAY_RESET_HOUR, type DayState } from '../core/types';
import {
  detectedUsernameItem,
  getSnapshot,
  lastGameEndItem,
  rememberLastGameEnd,
  serialize,
  setSnapshot,
  type DaySnapshot,
} from './storage';

/**
 * How long a snapshot is good for. The API declares `max-age=5`, so 15s is conservative,
 * and repeat requests resolve to a bodyless 304 anyway.
 */
const TTL_MS = 15_000;

export type SyncOutcome =
  | { ok: true; state: DayState }
  | { ok: false; reason: 'no-account' | 'network-error'; state: DayState; detail?: string };

/**
 * Brings the day's counts up to date and returns them.
 *
 * The API is the only source: it carries the real game type and result, draws included,
 * and picks up games played on mobile too. Nothing is read from the page to count.
 *
 * On failure we return the last thing we knew rather than an empty state: an empty list
 * would look like "no games today" and would lift the block exactly when it shouldn't.
 */
export async function syncDay(input: {
  now: number;
  force?: boolean;
  fetchImpl?: Fetcher;
}): Promise<SyncOutcome> {
  const { now, force = false, fetchImpl } = input;
  const dayKey = dayKeyOf(now, DAY_RESET_HOUR);
  // Independent keys, so they are read together: this runs on every message a chess.com
  // tab sends, and three sequential reads are three storage round trips before any
  // decision is made. The snapshot is keyed by account — after a sign-in change nothing
  // stored may stand, stamps included, or a 304 would keep counting the old account.
  const [username, lastStoredEnd] = await Promise.all([
    detectedUsernameItem.getValue(),
    lastGameEndItem.getValue(),
  ]);
  let lastEnd = lastStoredEnd;
  const stored = (await getSnapshot(now, username)) ?? {
    dayKey,
    username: username ?? '',
    games: {},
    fetchedAt: 0,
    etags: {},
  };
  const asState = (snapshot: DaySnapshot, lastEnd: number | null): DayState => ({
    dayKey,
    games: snapshot.games,
    ...(lastEnd === null ? {} : { lastGameEndedAt: lastEnd }),
  });

  if (username === null) {
    return { ok: false, reason: 'no-account', state: asState(stored, lastEnd) };
  }

  if (!force && now - stored.fetchedAt < TTL_MS)
    return { ok: true, state: asState(stored, lastEnd) };

  const dayStart = dayStartMs(dayKey, DAY_RESET_HOUR);
  const dayEnd = dayEndMs(dayKey, DAY_RESET_HOUR);

  try {
    const archive = await fetchGamesCovering({
      username,
      startMs: dayStart,
      endMs: dayEnd,
      // `?? {}` for the snapshot a previous version wrote, which has no ETags: it asks
      // unconditionally once and is rewritten in the current shape below.
      etags: stored.etags ?? {},
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });

    // Converted once and read twice: the day slice below, and the latest end here.
    const records = archive.unchanged ? [] : toRecords(archive.games, username);

    // Taken from the whole archive, not the day slice: the gap has to survive midnight.
    if (!archive.unchanged) lastEnd = await rememberLastGameEnd(lastGameEnd(records));

    const snapshot = await serialize(async () => {
      const next: DaySnapshot = {
        dayKey,
        username,
        // A 304 on every month means you have not played since last time, so the games we
        // already had still stand.
        games: archive.unchanged ? stored.games : gamesForDay({ records, dayStart, dayEnd }),
        fetchedAt: now,
        etags: { ...stored.etags, ...archive.etags },
      };
      await setSnapshot(next);
      return next;
    });

    return { ok: true, state: asState(snapshot, lastEnd) };
  } catch (error) {
    return {
      ok: false,
      reason: 'network-error',
      state: asState(stored, lastEnd),
      detail: String(error),
    };
  }
}
