import {
  fetchGamesCovering,
  fetchStats,
  monthKey,
  monthsCovering,
  type Fetcher,
  type Totals,
} from '../api/chesscom-api';
import { dayEndMs, dayKeyOf, dayStartMs } from '../core/day';
import { ARCHIVE_DELAY_MS, gamesForDay, lastGameEnd, toRecords } from '../core/games';
import { DAY_RESET_HOUR, GAME_TYPES, type DayState, type GameType } from '../core/types';
import {
  detectedUsernameItem,
  forgetFinished,
  getFinished,
  getSnapshot,
  lastGameEndItem,
  rememberLastGameEnd,
  rememberRatings,
  serialize,
  setSnapshot,
  type Counters,
  type DaySnapshot,
} from './storage';

/**
 * How long a snapshot is good for. The API declares `max-age=5`, so 15s is conservative,
 * and repeat requests resolve to a bodyless 304 anyway.
 */
const TTL_MS = 15_000;

/**
 * Games chess.com has counted that the archive has not handed us yet.
 *
 * Two of chess.com's own numbers, reached by two different roads: `/stats` keeps a
 * lifetime record per game type, and the monthly archive lists the games. Publish a game
 * and both move by one. So when the record has moved further than the archive has, the
 * difference is not a discrepancy to reconcile — it is a game that exists, played by you,
 * that the archive has yet to say a word about.
 *
 * This is worth the second request because the failure it catches is silent and it is the
 * dangerous one. On 22 Aug 2026 chess.com served a copy of the archive that had been
 * pinned in its CDN for hours; every count came back short by the games played since, and
 * nothing in the answer distinguished that from an afternoon of not playing. A quota that
 * cannot tell those apart lifts itself exactly when it should not.
 *
 * Clamped at zero. A negative difference means the archive is *ahead* of the record —
 * which happens, because `record` counts rated games and the archive counts every game —
 * and there is nothing to wait for in that direction.
 */
export function pendingOf(
  totals: Totals,
  reflected: Totals | undefined,
): Partial<Record<GameType, number>> {
  const pending: Partial<Record<GameType, number>> = {};
  if (reflected === undefined) return pending;

  for (const gameType of GAME_TYPES) {
    const counted = totals[gameType];
    const known = reflected[gameType];
    if (counted === undefined || known === undefined) continue;
    const behind = counted - known;
    if (behind > 0) pending[gameType] = behind;
  }
  return pending;
}

/**
 * The two ways of knowing, folded into one count per game type.
 *
 * The larger of the two, never the sum. They are two views of the same games, not two sets
 * of them: a game the page saw end is one chess.com's record will also have counted, so
 * adding them would charge you twice for finishing one game. Whichever source has noticed
 * more is the one that has noticed sooner.
 */
function merge(
  a: Partial<Record<GameType, number>>,
  b: Partial<Record<GameType, number>>,
): Partial<Record<GameType, number>> {
  const merged: Partial<Record<GameType, number>> = {};
  for (const gameType of GAME_TYPES) {
    const most = Math.max(a[gameType] ?? 0, b[gameType] ?? 0);
    if (most > 0) merged[gameType] = most;
  }
  return merged;
}

/** Games per game type across every month the archive just handed over. */
function totalsOf(records: { gameType: GameType }[]): Totals {
  const totals: Totals = {};
  for (const record of records) totals[record.gameType] = (totals[record.gameType] ?? 0) + 1;
  return totals;
}

/**
 * Moves the mark for "what the archive accounts for" forward by however much the archive
 * grew, so the gap to `/stats` closes as the games get published.
 *
 * Not simply set to what `/stats` says right now, which is the tempting shortcut and is
 * wrong: the body we just read may itself be missing a game the record already counts,
 * and taking today's record as the new mark would bless that gap as normal and lose the
 * game for good. Each side advances by its own reckoning; only a game appearing in the
 * archive can settle a game the record has seen.
 *
 * A game type the previous mark never held is seeded from the record instead. That is the
 * first game of a type you had never played, where there is no gap to preserve.
 */
function advance(previous: Counters, archived: Totals, totals: Totals): Totals {
  const reflected: Totals = {};
  for (const gameType of GAME_TYPES) {
    const mark = previous.reflected[gameType];
    if (mark === undefined) {
      const seed = totals[gameType];
      if (seed !== undefined) reflected[gameType] = seed;
      continue;
    }
    const growth = (archived[gameType] ?? 0) - (previous.archived[gameType] ?? 0);
    reflected[gameType] = mark + growth;
  }
  return reflected;
}

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
  /**
   * Ask for the months in full, ignoring the stored `ETag`s.
   *
   * A conditional request cannot see past a validator that says "nothing changed", and
   * that is the one answer a game we know has ended must not be left sitting behind. Used
   * only while chasing such a game, and rarely even then: it is a megabyte of month
   * against a count that is knowably wrong.
   */
  fresh?: boolean;
  fetchImpl?: Fetcher;
}): Promise<SyncOutcome> {
  const { now, force = false, fresh = false, fetchImpl } = input;
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
    ...(snapshot.pending === undefined ? {} : { pending: snapshot.pending }),
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
    /*
     * Both reads at once, and the small one is not optional.
     *
     * `/stats` is 400 bytes against the archive's megabyte, and it is the only thing in
     * the answer that can tell "you have played nothing since" apart from "the archive is
     * not telling me". They are asked together so the pair is read at one instant: a
     * record fetched a minute after the games it is compared against would show movement
     * that the archive had already published.
     */
    const [archive, stats] = await Promise.all([
      fetchGamesCovering({
        username,
        startMs: dayStart,
        endMs: dayEnd,
        // `?? {}` for the snapshot a previous version wrote, which has no ETags: it asks
        // unconditionally once and is rewritten in the current shape below.
        etags: fresh ? {} : (stored.etags ?? {}),
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
      }),
      fetchStats(username, fetchImpl),
    ]);

    // Converted once and read three times: the day slice below, the latest end here, and
    // what the last game of each type left you rated.
    const { records, ratings } = archive.unchanged
      ? { records: [], ratings: {} }
      : toRecords(archive.games, username);

    if (!archive.unchanged) {
      // Taken from the whole archive, not the day slice: the gap has to survive midnight.
      lastEnd = await rememberLastGameEnd(lastGameEnd(records));

      // Recorded where a game becomes known, so the rating beside a game type moves in the
      // same beat as the count beside it. Asked for anywhere else it arrives later, which
      // on the screen you open right after a game is the whole of the difference.
      await rememberRatings(username, 'played', ratings);
    }

    /*
     * The two marks that make `pendingOf` mean something, kept only when the profile
     * actually answered: a mark seeded from a read that failed would read as "chess.com
     * has counted nothing", and every game played since would be waved through.
     *
     * They are keyed by the months they were taken over. A day that spans two months, or
     * the first day of a new one, changes what "games in the archive" counts, and a mark
     * compared across that change would invent a gap out of the arithmetic. Reseeding
     * costs one cycle of the signal at a month boundary and cannot be wrong.
     */
    const months = monthsCovering(dayStart, dayEnd).map(monthKey).join(',');
    let counters = stored.counters;
    if (stats !== null && !archive.unchanged) {
      const archived = totalsOf(records);
      counters = {
        months,
        archived,
        reflected:
          stored.counters?.months === months
            ? advance(stored.counters, archived, stats.totals)
            : stats.totals,
      };
    }

    const fromStats =
      stats === null ? (stored.pending ?? {}) : pendingOf(stats.totals, counters?.reflected);

    /*
     * The games the page told us about, minus the ones that no longer need telling.
     *
     * Retired on the archive listing the id — the same key, so this cannot miscount — and
     * otherwise on the clock: past `ARCHIVE_DELAY_MS` a game that has not appeared is more
     * likely never to, an aborted one or one chess.com decided not to publish, and holding
     * a quota against it forever is not a thing to do to somebody.
     */
    const games = archive.unchanged ? stored.games : gamesForDay({ records, dayStart, dayEnd });
    const finished = await getFinished();
    const done = Object.keys(finished).filter(
      (id) => games[id] !== undefined || now - finished[id]!.at > ARCHIVE_DELAY_MS,
    );
    await forgetFinished(done);

    const fromPage: Partial<Record<GameType, number>> = {};
    for (const [id, game] of Object.entries(finished)) {
      if (done.includes(id)) continue;
      fromPage[game.gameType] = (fromPage[game.gameType] ?? 0) + 1;
    }

    const pending = merge(fromStats, fromPage);

    const snapshot = await serialize(async () => {
      const next: DaySnapshot = {
        dayKey,
        username,
        // A 304 on every month means you have not played since last time, so the games we
        // already had still stand.
        games,
        fetchedAt: now,
        etags: { ...stored.etags, ...archive.etags },
        ...(counters === undefined ? {} : { counters }),
        pending,
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
