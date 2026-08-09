import { fetchGamesCovering, type Fetcher } from '../api/chesscom-api';
import { dayEndMs, dayKeyOf, dayStartMs } from '../core/day';
import { gamesForDay } from '../core/games';
import { DAY_RESET_HOUR, type DayState } from '../core/types';
import {
  detectedUsernameItem,
  getSnapshot,
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
  const stored = (await getSnapshot(now)) ?? { dayKey, games: {}, fetchedAt: 0, lastModified: {} };
  const asState = (snapshot: DaySnapshot): DayState => ({ dayKey, games: snapshot.games });

  const username = await detectedUsernameItem.getValue();
  if (username === null) return { ok: false, reason: 'no-account', state: asState(stored) };

  if (!force && now - stored.fetchedAt < TTL_MS) return { ok: true, state: asState(stored) };

  const dayStart = dayStartMs(dayKey, DAY_RESET_HOUR);
  const dayEnd = dayEndMs(dayKey, DAY_RESET_HOUR);

  try {
    const archive = await fetchGamesCovering({
      username,
      startMs: dayStart,
      endMs: dayEnd,
      lastModified: stored.lastModified,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });

    const snapshot = await serialize(async () => {
      const next: DaySnapshot = {
        dayKey,
        // A 304 on every month means you have not played since last time, so the games we
        // already had still stand.
        games: archive.unchanged
          ? stored.games
          : gamesForDay({ apiGames: archive.games, username, dayStart, dayEnd }),
        fetchedAt: now,
        lastModified: { ...stored.lastModified, ...archive.lastModified },
      };
      await setSnapshot(next);
      return next;
    });

    return { ok: true, state: asState(snapshot) };
  } catch (error) {
    return { ok: false, reason: 'network-error', state: asState(stored), detail: String(error) };
  }
}
