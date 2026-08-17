import { describe, expect, it, vi } from 'vitest';
import {
  archiveUrl,
  fetchAvatar,
  fetchGamesCovering,
  monthKey,
  monthsCovering,
} from './chesscom-api';

const at = (iso: string) => new Date(iso).getTime();

function response(body: unknown, status = 200, etag?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (h: string) => (h === 'etag' ? (etag ?? null) : null) },
  } as Response;
}

const ONE_DAY = { startMs: at('2026-08-08T00:00:00'), endMs: at('2026-08-09T00:00:00') };
const ACROSS_MONTHS = { startMs: at('2026-08-31T04:00:00'), endMs: at('2026-09-01T04:00:00') };

describe('archiveUrl', () => {
  it('pads the month and normalises the username', () => {
    expect(archiveUrl('AlbaJuega', { year: 2026, month: 8 })).toBe(
      'https://api.chess.com/pub/player/albajuega/games/2026/08',
    );
    expect(archiveUrl('a b', { year: 2026, month: 12 })).toBe(
      'https://api.chess.com/pub/player/a%20b/games/2026/12',
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
    const fetchImpl = vi.fn().mockResolvedValue(response({ games: [{ url: 'x' }] }));
    await expect(run(fetchImpl)).resolves.toMatchObject({ unchanged: false });
  });

  it('a month with no games (404) is an empty list, not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 404));
    await expect(run(fetchImpl)).resolves.toMatchObject({ games: [] });
  });

  // An empty list from an error would look like "no games today" and lift the block.
  it('a server error propagates rather than pretending you did not play', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 500));
    await expect(run(fetchImpl)).rejects.toThrow('500');
  });

  it('merges the archives of every month it needs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ games: [{ url: 'august' }] }))
      .mockResolvedValueOnce(response({ games: [{ url: 'september' }] }));
    const result = await fetchGamesCovering({ username: 'alba', ...ACROSS_MONTHS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.games.map((g) => g.url)).toEqual(['august', 'september']);
  });

  describe('conditional caching', () => {
    const STAMP = 'W/"40d3008742dde2cb45bf2cf501c1eece"';

    it('keeps the ETag the server sends back', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response({ games: [] }, 200, STAMP));
      await expect(run(fetchImpl)).resolves.toMatchObject({ etags: { '2026-08': STAMP } });
    });

    /**
     * The ETag and not the `Last-Modified`, which the server also sends and then ignores:
     * measured against it, `If-Modified-Since` answers 200 with the whole megabyte however
     * the stamp is spelled. Conditioning on the wrong header is not a slower cache, it is
     * no cache at all.
     */
    it('sends it back as If-None-Match', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response({ games: [] }));
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
      const fetchImpl = vi.fn().mockResolvedValue(response({ games: [] }));
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
        .mockResolvedValueOnce(response({ games: [{ url: 'new' }] }))
        .mockResolvedValueOnce(response({ games: [{ url: 'old' }] }, 200, STAMP));
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
