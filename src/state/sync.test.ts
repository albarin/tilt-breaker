import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiGame } from '../core/games';
import { countOf } from '../core/policy';
import {
  getRatings,
  rememberFinishedGame,
  rememberDetectedUsername,
  rememberLastGameEnd,
  rememberRatings,
} from './storage';
import { syncDay } from './sync';
import { toArchive } from '../api/pgn.fixture';

const ME = 'crabinloan';
const NOON = new Date('2026-08-08T12:00:00');

/**
 * A fake response that can be either of the two things a sync reads: the archive, which
 * is PGN text, and the profile, which is JSON.
 */
function response(body: unknown, status = 200, etag?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : ''),
    headers: { get: (h: string) => (h === 'etag' ? (etag ?? null) : null) },
  } as Response;
}

function apiGame(id: string, overrides: Partial<ApiGame> = {}): ApiGame {
  return {
    url: `https://www.chess.com/game/live/${id}`,
    time_class: 'bullet',
    end_time: Math.floor(NOON.getTime() / 1000) - 600,
    white: { username: ME, result: 'win' },
    black: { username: 'Rival', result: 'loss' },
    ...overrides,
  };
}

/**
 * What `/stats` says unless a test says otherwise.
 *
 * Every sync reads it, and its totals are what `pendingOf` compares the archive against.
 * Held still here on purpose: a total that does not move is chess.com agreeing with the
 * archive, which is the ordinary case and the one that must not colour a test about
 * something else.
 */
const STATS = { chess_bullet: { record: { win: 40 } }, chess_blitz: { record: { win: 7 } } };

/** How many games of each type chess.com's profile has counted, ever. */
const played = (bullet: number) => ({ chess_bullet: { record: { win: bullet } } });

/**
 * A fake fetch answering both requests a sync makes, routed by URL.
 *
 * The archive answers are handed out in order and the last one repeats, so a test says
 * only as much as it cares about: one response covers every sync, two say "this, then
 * that from here on".
 */
function serve(archives: Response | Response[], stats: unknown | unknown[] = STATS): typeof fetch {
  const queue = Array.isArray(archives) ? [...archives] : [archives];
  const profiles = Array.isArray(stats) ? [...stats] : [stats];
  let lastArchive = queue[0]!;
  let lastProfile = profiles[0];

  return vi.fn(async (url: string) => {
    if (String(url).endsWith('/stats')) {
      lastProfile = profiles.length > 0 ? profiles.shift() : lastProfile;
      // A `Response` stands for itself: that is how a test says the profile would not load.
      return isResponse(lastProfile) ? lastProfile : response(lastProfile);
    }
    lastArchive = queue.shift() ?? lastArchive;
    return lastArchive;
  }) as unknown as typeof fetch;
}

function isResponse(value: unknown): value is Response {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

/**
 * The archive requests only.
 *
 * Call counts are about the megabyte, never about the 400 bytes of profile that rides
 * alongside it, so the profile reads are filtered out rather than counted and explained.
 */
function archiveCalls(fetchImpl: typeof fetch): unknown[][] {
  const mock = fetchImpl as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.filter(([url]) => !String(url).endsWith('/stats'));
}

const archive = (...games: ApiGame[]) => serve(response(toArchive(...games)));
const sync = (fetchImpl: typeof fetch, force = false) =>
  syncDay({ now: NOON.getTime(), fetchImpl, force });

beforeEach(async () => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  await rememberDetectedUsername(ME);
});

describe('syncDay', () => {
  it('counts what the API reports', async () => {
    const outcome = await sync(archive(apiGame('1'), apiGame('2')));
    expect(outcome.ok).toBe(true);
    expect(countOf(outcome.state, 'bullet')).toBe(2);
  });

  it('with no detected account it counts nothing and says so', async () => {
    fakeBrowser.reset();
    const outcome = await sync(archive(apiGame('1')));
    expect(outcome).toMatchObject({ ok: false, reason: 'no-account' });
    expect(countOf(outcome.state, 'bullet')).toBe(0);
  });

  it('asks for the right month', async () => {
    const fetchImpl = archive();
    await sync(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.chess.com/pub/player/crabinloan/games/2026/08/pgn',
      expect.anything(),
    );
  });

  describe('caching', () => {
    it('does not ask again within the TTL', async () => {
      const fetchImpl = archive(apiGame('1'));
      await sync(fetchImpl);
      await sync(fetchImpl);
      expect(archiveCalls(fetchImpl)).toHaveLength(1);
    });

    it('`force` skips the TTL', async () => {
      const fetchImpl = archive(apiGame('1'));
      await sync(fetchImpl);
      await sync(fetchImpl, true);
      expect(archiveCalls(fetchImpl)).toHaveLength(2);
    });

    it('asks again once the TTL is past', async () => {
      const fetchImpl = archive(apiGame('1'));
      await sync(fetchImpl);
      const later = NOON.getTime() + 20_000;
      vi.setSystemTime(later);
      await syncDay({ now: later, fetchImpl });
      expect(archiveCalls(fetchImpl)).toHaveLength(2);
    });

    it('a 304 does not empty the count', async () => {
      await sync(serve(response(toArchive(apiGame('1')), 200, 'stamp')), true);
      const outcome = await sync(serve(response(null, 304)), true);
      expect(countOf(outcome.state, 'bullet')).toBe(1);
    });
  });

  // An empty list from a failure would look like "no games today" and lift the block.
  describe('when the API fails', () => {
    it('keeps the last thing it knew', async () => {
      await sync(archive(apiGame('1'), apiGame('2')), true);
      const outcome = await sync(serve(response('', 500)), true);
      expect(outcome).toMatchObject({ ok: false, reason: 'network-error' });
      expect(countOf(outcome.state, 'bullet')).toBe(2);
    });

    it('with nothing stored it lets you through rather than blocking blind', async () => {
      const outcome = await sync(serve(response('', 500)));
      expect(countOf(outcome.state, 'bullet')).toBe(0);
    });
  });

  /**
   * The snapshot is keyed by account, stamps included. Without that, the old account's
   * If-Modified-Since could 304 against the new account's archive and keep counting
   * games the new account never played.
   */
  it('an account switch drops the snapshot and its stamps', async () => {
    await sync(serve(response(toArchive(apiGame('1')), 200, 'stamp')), true);

    await rememberDetectedUsername('someone-else');
    const fetchImpl = archive();
    const outcome = await sync(fetchImpl, true);

    expect(countOf(outcome.state, 'bullet')).toBe(0);
    // Asked fresh, not conditionally: the stamp belonged to the previous account.
    expect(archiveCalls(fetchImpl).at(-1)).toEqual([
      expect.any(String),
      { headers: {}, cache: 'no-store' },
    ]);
  });

  it('resets on its own when the day changes', async () => {
    await sync(archive(apiGame('1')));
    const tomorrow = new Date('2026-08-09T12:00:00').getTime();
    vi.setSystemTime(tomorrow);
    const outcome = await syncDay({ now: tomorrow, fetchImpl: archive() });
    expect(countOf(outcome.state, 'bullet')).toBe(0);
  });
});

describe('last game end', () => {
  const endedAt = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  it('is reported so the gap between games can be applied', async () => {
    const outcome = await sync(archive(apiGame('1', { end_time: endedAt('2026-08-08T11:50:00') })));
    expect(outcome.state.lastGameEndedAt).toBe(new Date('2026-08-08T11:50:00').getTime());
  });

  /**
   * Taken from the whole archive rather than the day slice, and persisted apart from the
   * snapshot, so a game that ended at 23:58 still holds you back at 00:05.
   */
  it('survives the day rollover', async () => {
    await sync(archive(apiGame('1', { end_time: endedAt('2026-08-08T23:58:00') })), true);

    const nextDay = new Date('2026-08-09T00:05:00').getTime();
    vi.setSystemTime(nextDay);
    const outcome = await syncDay({ now: nextDay, fetchImpl: archive(), force: true });

    expect(countOf(outcome.state, 'bullet')).toBe(0); // the day did reset
    expect(outcome.state.lastGameEndedAt).toBe(new Date('2026-08-08T23:58:00').getTime());
  });

  it('never goes backwards', async () => {
    await sync(archive(apiGame('1', { end_time: endedAt('2026-08-08T11:50:00') })), true);
    const outcome = await sync(
      archive(apiGame('2', { end_time: endedAt('2026-08-08T09:00:00') })),
      true,
    );
    expect(outcome.state.lastGameEndedAt).toBe(new Date('2026-08-08T11:50:00').getTime());
  });

  it('is kept when the API cannot be reached', async () => {
    await sync(archive(apiGame('1', { end_time: endedAt('2026-08-08T11:50:00') })), true);
    const outcome = await sync(serve(response('', 500)), true);
    expect(outcome.state.lastGameEndedAt).toBe(new Date('2026-08-08T11:50:00').getTime());
  });
});

/**
 * The crux of the rapid bug: the archive lags a few seconds behind a finished game, and
 * during that window it still reports the *previous* one. After a long game that end is
 * old enough for the gap to have expired.
 */
describe('a game reported before the archive knows', () => {
  const endedAt = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const twentyMinutesAgo = apiGame('1', { end_time: endedAt('2026-08-08T11:40:00') });

  it('starts the gap, and the stale archive cannot pull it back', async () => {
    await sync(archive(twentyMinutesAgo), true);

    // The content script sees the modal and reports the finish at once.
    await rememberLastGameEnd(NOON.getTime());

    // The next sync still gets an archive that has not caught up.
    const outcome = await sync(archive(twentyMinutesAgo), true);
    expect(outcome.state.lastGameEndedAt).toBe(NOON.getTime());
  });

  it('and the archive confirms it once it catches up', async () => {
    await rememberLastGameEnd(NOON.getTime());
    const published = apiGame('2', { end_time: endedAt('2026-08-08T12:00:00') });
    const outcome = await sync(archive(twentyMinutesAgo, published), true);
    expect(outcome.state.lastGameEndedAt).toBe(NOON.getTime());
  });
});

/**
 * A conditional request is the right default and the wrong last word. The server answers
 * "nothing changed" and nothing downstream can tell that apart from the truth, so a game
 * we have been told has ended can sit behind a 304 — and the whole count with it.
 */
describe('asking for the month in full', () => {
  it('sends no stamp when told to read fresh', async () => {
    const fetchImpl = archive(apiGame('1'));
    await sync(fetchImpl, true);

    const fresh = archive(apiGame('1'), apiGame('2'));
    await syncDay({ now: NOON.getTime(), fetchImpl: fresh, force: true, fresh: true });

    expect(fresh).toHaveBeenCalledWith(expect.any(String), { headers: {}, cache: 'no-store' });
  });

  /** The stamp is still stored and still used the moment the chase is over. */
  it('goes back to asking conditionally', async () => {
    const fetchImpl = serve(response(toArchive(apiGame('1')), 200, 'W/"x"'));
    await sync(fetchImpl, true);
    await sync(fetchImpl, true);

    expect(archiveCalls(fetchImpl).at(-1)).toEqual([
      expect.any(String),
      { headers: { 'If-None-Match': 'W/"x"' }, cache: 'no-store' },
    ]);
  });
});

/**
 * The bug this fixes: the rating beside a game type was fetched from the profile on its
 * own schedule, so the count moved the moment a game was published and the number next to
 * it stayed as it was until some later refresh came round. It comes out of the same read
 * now, and 1.3.0's shape is gone rather than migrated.
 */
describe('ratings out of the same read as the counts', () => {
  const rated = (id: string, rating: number, overrides: Partial<ApiGame> = {}) =>
    apiGame(id, { white: { username: ME, result: 'win', rating }, ...overrides });

  it('records what the last game of each type left you on', async () => {
    await sync(
      archive(rated('1', 1200), rated('2', 1208), rated('3', 900, { time_class: 'rapid' })),
    );
    expect(await getRatings()).toEqual({
      username: ME,
      played: { bullet: 1208, rapid: 900 },
      profile: {},
    });
  });

  /** The profile's answer is the fallback, and a game must be free to overtake it. */
  it('a played rating wins over the profile, and neither wipes the other', async () => {
    await rememberRatings(ME, 'profile', { bullet: 1200, blitz: 1500 });
    await sync(archive(rated('1', 1208)), true);

    expect(await getRatings()).toEqual({
      username: ME,
      played: { bullet: 1208 },
      profile: { bullet: 1200, blitz: 1500 },
    });
  });

  /** A 304 carries no games, so it must not be read as "you are rated nothing". */
  it('an unchanged archive leaves them alone', async () => {
    await sync(archive(rated('1', 1208)));
    await sync(serve(response(null, 304)), true);
    expect((await getRatings())?.played).toEqual({ bullet: 1208 });
  });
});

/**
 * The hole this fills, and why it is worth a second request.
 *
 * On 22 Aug 2026 chess.com served a copy of the monthly archive that had been pinned in
 * its CDN for hours: `cf-cache-status: HIT`, `age: 1916` against its own `max-age=5`, ETag
 * frozen along with it. Every count came back short by the games played since, and nothing
 * in the answer told that apart from an afternoon of not playing. A quota that cannot tell
 * those apart lifts itself exactly when it should not.
 *
 * `/stats` is the second opinion. It is chess.com's own counter, reached by another road,
 * and when it has moved further than the archive has, the difference is a game that
 * exists — countable now, describable later.
 */
describe('games chess.com has counted that the archive has not published', () => {
  /** Seed the marks: one game in the archive, and a profile that agrees with it. */
  const seeded = () => sync(serve(response(toArchive(apiGame('1'))), played(40)), true);

  it('counts one against the quota before it is published', async () => {
    await seeded();
    const outcome = await sync(serve(response(null, 304), played(41)), true);

    expect(countOf(outcome.state, 'bullet')).toBe(2);
    expect(outcome.state.pending).toEqual({ bullet: 1 });
  });

  it('stops counting it separately once the archive lists it', async () => {
    await seeded();
    await sync(serve(response(null, 304), played(41)), true);

    const published = toArchive(apiGame('1'), apiGame('2'));
    const outcome = await sync(serve(response(published, 200, 'new'), played(41)), true);

    expect(countOf(outcome.state, 'bullet')).toBe(2);
    expect(outcome.state.pending).toEqual({});
  });

  /**
   * The archive counts every game and the profile record counts rated ones, so the archive
   * can be the one that is ahead. There is nothing to wait for in that direction, and a
   * negative difference must never subtract from the quota.
   */
  it('never counts below what the archive itself lists', async () => {
    await seeded();
    const bothPlayed = toArchive(apiGame('1'), apiGame('2'));
    const outcome = await sync(serve(response(bothPlayed, 200, 'new'), played(40)), true);

    expect(countOf(outcome.state, 'bullet')).toBe(2);
    expect(outcome.state.pending).toEqual({});
  });

  /**
   * The mark moves by what the archive gained, never to whatever the profile says now.
   * Set to the profile, a body that is itself missing a game would bless the gap as normal
   * and lose that game for good.
   */
  it('keeps waiting for the second game when the archive publishes only the first', async () => {
    await seeded();
    await sync(serve(response(null, 304), played(42)), true); // two games played

    const oneOfThem = toArchive(apiGame('1'), apiGame('2'));
    const outcome = await sync(serve(response(oneOfThem, 200, 'new'), played(42)), true);

    expect(outcome.state.pending).toEqual({ bullet: 1 });
    expect(countOf(outcome.state, 'bullet')).toBe(3);
  });

  /**
   * A profile that will not load is not a profile saying nothing happened. Forgetting a
   * pending game lifts a block; keeping it costs a stale notice for a few seconds.
   */
  it('keeps the last count when the profile cannot be read', async () => {
    await seeded();
    await sync(serve(response(null, 304), played(41)), true);

    const outcome = await sync(serve(response(null, 304), response('', 500)), true);
    expect(outcome.state.pending).toEqual({ bullet: 1 });
  });

  /** Nothing is pending before there is a mark to compare against. */
  it('waits for nothing on the first sync of a day', async () => {
    const outcome = await seeded();
    expect(outcome.state.pending).toEqual({});
    expect(countOf(outcome.state, 'bullet')).toBe(1);
  });
});

/**
 * The game the page saw end, counted before the archive says a word about it.
 *
 * `/stats` covers an archive that is frozen; this covers one that is merely slow, which is
 * the half-minute after every game — long enough to walk back to the lobby and start
 * another over the quota.
 */
describe('a game the page reported finishing', () => {
  const ENDED = '999000111';

  it('counts against the quota before the archive lists it', async () => {
    await rememberFinishedGame(ENDED, 'bullet');
    const outcome = await sync(archive(apiGame('1')), true);

    expect(countOf(outcome.state, 'bullet')).toBe(2);
    expect(outcome.state.pending).toEqual({ bullet: 1 });
  });

  /**
   * Retired by id, which is the same key the archive files it under. That is what makes
   * counting it early safe: the two halves cannot both be counted, being one key.
   */
  it('stops counting once the archive lists that same game', async () => {
    await rememberFinishedGame(ENDED, 'bullet');
    await sync(archive(apiGame('1')), true);

    const outcome = await sync(
      serve(response(toArchive(apiGame('1'), apiGame(ENDED)), 200, 'x')),
      true,
    );
    expect(countOf(outcome.state, 'bullet')).toBe(2);
    expect(outcome.state.pending).toEqual({});
  });

  /**
   * An aborted game is reported and never published. Holding a quota against it for the
   * rest of the day is not a thing to do to somebody.
   */
  it('gives up on it after the archive has had its five minutes', async () => {
    await rememberFinishedGame(ENDED, 'bullet');
    await sync(archive(apiGame('1')), true);

    const later = NOON.getTime() + 6 * 60_000;
    vi.setSystemTime(later);
    const outcome = await syncDay({ now: later, force: true, fetchImpl: archive(apiGame('1')) });

    expect(outcome.state.pending).toEqual({});
    expect(countOf(outcome.state, 'bullet')).toBe(1);
  });

  /**
   * Both sources describe the same game, so the count is the larger of the two and never
   * their sum — otherwise finishing one game would spend two of the quota.
   */
  it('is not counted twice when the profile has noticed it as well', async () => {
    await sync(serve(response(toArchive(apiGame('1'))), played(40)), true);
    await rememberFinishedGame(ENDED, 'bullet');

    const outcome = await sync(serve(response(null, 304), played(41)), true);
    expect(outcome.state.pending).toEqual({ bullet: 1 });
    expect(countOf(outcome.state, 'bullet')).toBe(2);
  });
});
