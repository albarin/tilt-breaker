import { describe, expect, it, vi } from 'vitest';
import {
  archiveUrl,
  fetchAvatar,
  fetchGamesCovering,
  monthKey,
  monthsCovering,
} from './chesscom-api';

const at = (iso: string) => new Date(iso).getTime();

function response(body: unknown, status = 200, lastModified?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (h: string) => (h === 'last-modified' ? (lastModified ?? null) : null) },
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
  const run = (fetchImpl: typeof fetch, lastModified = {}) =>
    fetchGamesCovering({ username: 'alba', ...ONE_DAY, lastModified, fetchImpl });

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
    const STAMP = 'Saturday, 08-Aug-2026 20:46:13 GMT+0000';

    it('keeps the Last-Modified the server sends back', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response({ games: [] }, 200, STAMP));
      await expect(run(fetchImpl)).resolves.toMatchObject({ lastModified: { '2026-08': STAMP } });
    });

    it('sends it back as If-Modified-Since', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response({ games: [] }));
      await run(fetchImpl, { '2026-08': STAMP });
      expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), {
        headers: { 'If-Modified-Since': STAMP },
      });
    });

    // The archive runs close to a megabyte mid-month: the 304 is what makes polling it
    // this often viable.
    it('a 304 carries no games and reports no change', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(response(null, 304));
      const result = await run(fetchImpl, { '2026-08': STAMP });
      expect(result).toMatchObject({ games: [], unchanged: true });
      expect(result.lastModified['2026-08']).toBe(STAMP);
    });

    it('one month changing is enough to stop being "unchanged"', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response(null, 304))
        .mockResolvedValueOnce(response({ games: [{ url: 'new' }] }));
      const result = await fetchGamesCovering({
        username: 'alba',
        ...ACROSS_MONTHS,
        lastModified: { '2026-08': STAMP, '2026-09': STAMP },
        fetchImpl,
      });
      expect(result.unchanged).toBe(false);
      expect(result.games.map((g) => g.url)).toEqual(['new']);
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
