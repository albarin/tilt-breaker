import { describe, expect, it, vi } from 'vitest';
import {
  archiveUrl,
  fetchAvatar,
  fetchGamesCovering,
  fetchStats,
  monthKey,
  monthsCovering,
} from './chesscom-api';
import { toArchive } from './pgn.fixture';
import type { ApiGame } from '../core/games';

const at = (iso: string) => new Date(iso).getTime();

/**
 * The archive answers with PGN and `/stats` with JSON, so a fake response has to be able
 * to be either. A string body is served as text, anything else as JSON.
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

const at2 = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** One archive game, as PGN, with only the fields these tests look at. */
function game(url: string): ApiGame {
  return {
    url,
    time_class: 'blitz',
    end_time: at2('2026-08-08T12:00:00Z'),
    white: { username: 'alba', result: 'win' },
    black: { username: 'Rival', result: 'loss' },
  };
}

const month = (...urls: string[]) => toArchive(...urls.map(game));

const ONE_DAY = { startMs: at('2026-08-08T00:00:00'), endMs: at('2026-08-09T00:00:00') };
const ACROSS_MONTHS = { startMs: at('2026-08-31T04:00:00'), endMs: at('2026-09-01T04:00:00') };

describe('archiveUrl', () => {
  it('pads the month and normalises the username', () => {
    expect(archiveUrl('AlbaJuega', { year: 2026, month: 8 })).toBe(
      'https://api.chess.com/pub/player/albajuega/games/2026/08/pgn',
    );
    expect(archiveUrl('a b', { year: 2026, month: 12 })).toBe(
      'https://api.chess.com/pub/player/a%20b/games/2026/12/pgn',
    );
  });
});

describe('monthKey', () => {
  it('gives a stable per-month key', () => {
    expect(monthKey({ year: 2026, month: 8 })).toBe('2026-08');
  });
});

describe('monthsCovering', () => {
  it('an ordinary day fits in one archive', () => {
    expect(monthsCovering(ONE_DAY.startMs, ONE_DAY.endMs)).toEqual([{ year: 2026, month: 8 }]);
  });

  it('a day straddling two months asks for both archives', () => {
    expect(monthsCovering(ACROSS_MONTHS.startMs, ACROSS_MONTHS.endMs)).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
  });

  /**
   * Archives are keyed by UTC month. In Madrid (UTC+2 in summer) 01:00 on 1 September is
   * still 31 August in UTC, so those games live in the August archive.
   */
  it('months are computed in UTC, the way chess.com stores them', () => {
    expect(monthsCovering(at('2026-09-01T01:00:00'), at('2026-09-01T01:30:00'))).toEqual([
      { year: 2026, month: 8 },
    ]);
  });
});

describe('fetchGamesCovering', () => {
  const run = (fetchImpl: typeof fetch, etags = {}) =>
    fetchGamesCovering({ username: 'alba', ...ONE_DAY, etags, fetchImpl });

  it('returns the games in the archive', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(month('x')));
    await expect(run(fetchImpl)).resolves.toMatchObject({ unchanged: false });
  });

  it('a month with no games is an empty body, not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(''));
    await expect(run(fetchImpl)).resolves.toMatchObject({ games: [], unchanged: false });
  });

  /**
   * On 9 Sep 2026 the PGN endpoint answered 404 for the current month of every account: a
   * Twirp "internal error" wearing a not-found status. Read as "no games this month", it
   * emptied the day. The JSON twin at the same path kept answering, so that is where a
   * month the PGN will not give up is asked for.
   */
  describe('when the PGN endpoint fails', () => {
    const JSON_GAME = {
      url: 'https://www.chess.com/game/live/1',
      time_control: '180',
      end_time: at2('2026-08-08T12:00:00Z'),
      white: { username: 'alba', result: 'win', rating: 800 },
      black: { username: 'Rival', result: 'checkmated', rating: 790 },
    };

    it('a 404 is asked again as JSON, never read as an empty month', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response({}, 404))
        .mockResolvedValueOnce(response({ games: [JSON_GAME] }, 200, 'json-stamp'));

      const result = await run(fetchImpl);

      expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
        'https://api.chess.com/pub/player/alba/games/2026/08/pgn',
        'https://api.chess.com/pub/player/alba/games/2026/08',
      ]);
      expect(result.games).toEqual([
        {
          url: JSON_GAME.url,
          time_class: 'blitz',
          end_time: JSON_GAME.end_time,
          white: { username: 'alba', result: 'win', rating: 800 },
          black: { username: 'Rival', result: 'loss', rating: 790 },
        },
      ]);
      expect(result).toMatchObject({ unchanged: false, etags: { '2026-08': 'json-stamp' } });
    });

    it('a 500 takes the same road', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response({}, 500))
        .mockResolvedValueOnce(response({ games: [] }));
      await expect(run(fetchImpl)).resolves.toMatchObject({ games: [], unchanged: false });
    });

    it('a JSON stamp that still matches is a month unchanged', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response({}, 404))
        .mockResolvedValueOnce(response(null, 304));
      await expect(run(fetchImpl, { '2026-08': 'json-stamp' })).resolves.toMatchObject({
        unchanged: true,
        etags: { '2026-08': 'json-stamp' },
      });
      expect(fetchImpl.mock.calls[1]![1]).toMatchObject({
        headers: { 'If-None-Match': 'json-stamp' },
      });
    });

    // An empty list from an error would look like "no games today" and lift the block.
    it('both failing propagates rather than pretending you did not play', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response({}, 404))
        .mockResolvedValueOnce(response({}, 500));
      await expect(run(fetchImpl)).rejects.toThrow('404 (PGN) and 500 (JSON)');
    });
  });

  it('merges the archives of every month it needs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(month('august')))
      .mockResolvedValueOnce(response(month('september')));
    const result = await fetchGamesCovering({ username: 'alba', ...ACROSS_MONTHS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.games.map((g) => g.url)).toEqual(['august', 'september']);
  });

  describe('conditional caching', () => {
    const STAMP = 'W/"40d3008742dde2cb45bf2cf501c1eece"';

    it('keeps the ETag the server sends back', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response(month(), 200, STAMP));
      await expect(run(fetchImpl)).resolves.toMatchObject({ etags: { '2026-08': STAMP } });
    });

    /**
     * The ETag and not the `Last-Modified`, which the server also sends and then ignores:
     * measured against it, `If-Modified-Since` answers 200 with the whole megabyte however
     * the stamp is spelled. Conditioning on the wrong header is not a slower cache, it is
     * no cache at all.
     */
    it('sends it back as If-None-Match', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response(month()));
      await run(fetchImpl, { '2026-08': STAMP });
      expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), {
        headers: { 'If-None-Match': STAMP },
        cache: 'no-store',
      });
    });

    /**
     * The archive is served `max-age=5`, so two requests inside five seconds — the sync a
     * finished game triggers, then the popup opened right after — would be one request and
     * one replay of its answer, both predating the game just played.
     */
    it('never reads the browser cache', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response(month()));
      await run(fetchImpl);
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });

    // The archive runs close to a megabyte mid-month: the 304 is what makes polling it
    // this often viable.
    it('a 304 carries no games and reports no change', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response(null, 304));
      const result = await run(fetchImpl, { '2026-08': STAMP });
      expect(result).toMatchObject({ games: [], unchanged: true });
      expect(result.etags['2026-08']).toBe(STAMP);
    });

    /**
     * The day is rebuilt from `games` alone, so on a mixed answer the 304'd month must be
     * fetched again in full — otherwise its games would vanish from the count and lift
     * the block on every month boundary.
     */
    it("one month changing refetches the 304'd one in full", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response(null, 304))
        .mockResolvedValueOnce(response(month('new')))
        .mockResolvedValueOnce(response(month('old'), 200, STAMP));
      const result = await fetchGamesCovering({
        username: 'alba',
        ...ACROSS_MONTHS,
        etags: { '2026-08': STAMP, '2026-09': STAMP },
        fetchImpl,
      });
      expect(result.unchanged).toBe(false);
      expect(result.games.map((g) => g.url).sort()).toEqual(['new', 'old']);
      // The refetch must not send the stamp back, or it would just 304 again.
      expect(fetchImpl).toHaveBeenLastCalledWith(expect.any(String), {
        headers: {},
        cache: 'no-store',
      });
    });
  });
});

describe('fetchAvatar', () => {
  it('returns the avatar from the profile', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ avatar: 'https://img/x.png' }));
    await expect(fetchAvatar('alba', fetchImpl)).resolves.toBe('https://img/x.png');
  });

  it('accounts without one give null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ username: 'alba' }));
    await expect(fetchAvatar('alba', fetchImpl)).resolves.toBeNull();
  });

  /**
   * An avatar is decoration. Unlike the archive, a failure here must stay quiet: it
   * shares this client with the counting, which must not be disturbed by it.
   */
  it('never throws, whatever goes wrong', async () => {
    const notFound = vi.fn().mockResolvedValue(response({}, 404));
    await expect(fetchAvatar('alba', notFound)).resolves.toBeNull();

    const broken = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchAvatar('alba', broken)).resolves.toBeNull();
  });
});

describe('fetchStats', () => {
  const stats = (body: unknown) => vi.fn().mockResolvedValue(response(body));
  const record = { win: 10, loss: 5, draw: 1 };

  it('reads the live rating of each game type off the profile', async () => {
    const fetchImpl = stats({
      chess_bullet: { last: { rating: 1204, rd: 30 }, best: { rating: 1310 } },
      chess_blitz: { last: { rating: 987 } },
      chess_rapid: { last: { rating: 1455 } },
    });

    await expect(fetchStats('Alba', fetchImpl)).resolves.toMatchObject({
      ratings: { bullet: 1204, blitz: 987, rapid: 1455 },
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.chess.com/pub/player/alba/stats', {
      cache: 'no-store',
    });
  });

  /**
   * `best` is a record and `daily` is not a game type we limit, so neither may be read as
   * "what you are rated" — that is `last`, and only for the three live types.
   */
  it('ignores the rest of the profile', async () => {
    const fetchImpl = stats({
      chess_daily: { last: { rating: 1600 }, record },
      chess_blitz: { best: { rating: 1500 } },
      tactics: { highest: { rating: 2000 } },
    });
    await expect(fetchStats('alba', fetchImpl)).resolves.toEqual({ ratings: {}, totals: {} });
  });

  /**
   * A game type you have never played has no rating, and the popup leaves the name to
   * stand alone. Sending a `0` would put a number there that you are not rated.
   */
  it('leaves out a game type the account has never played', async () => {
    const fetchImpl = stats({ chess_blitz: { last: { rating: 987 } } });
    await expect(fetchStats('alba', fetchImpl)).resolves.toMatchObject({
      ratings: { blitz: 987 },
    });
  });

  describe('the games-played totals', () => {
    it('adds up the profile record per game type', async () => {
      const fetchImpl = stats({ chess_blitz: { record }, chess_bullet: { record: { win: 2 } } });
      await expect(fetchStats('alba', fetchImpl)).resolves.toMatchObject({
        totals: { blitz: 16, bullet: 2 },
      });
    });

    /**
     * Summed over whatever the record holds rather than over three keys by name. A fourth
     * outcome one day must raise the total: a total that is short reads as an archive that
     * is late, and would have games waiting on a publication that already happened.
     */
    it('counts an outcome it has never seen before', async () => {
      const fetchImpl = stats({ chess_blitz: { record: { ...record, adjourned: 3 } } });
      await expect(fetchStats('alba', fetchImpl)).resolves.toMatchObject({
        totals: { blitz: 19 },
      });
    });

    /** A type with no record is left out, the way a type with no rating is. */
    it('leaves out a game type with no record at all', async () => {
      const fetchImpl = stats({ chess_blitz: { last: { rating: 987 } } });
      await expect(fetchStats('alba', fetchImpl)).resolves.toMatchObject({ totals: {} });
    });
  });

  /**
   * It shares this client with the counting, which must not be disturbed by it. `null` is
   * the caller's cue to keep the last thing it knew — for the ratings that is three
   * numbers on the popup, and for the totals it is "no movement seen", which is the only
   * safe reading: a total invented as zero would look like every game since was published.
   */
  it('never throws, whatever goes wrong', async () => {
    const notFound = vi.fn().mockResolvedValue(response({}, 404));
    await expect(fetchStats('alba', notFound)).resolves.toBeNull();

    const broken = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchStats('alba', broken)).resolves.toBeNull();
  });
});
