import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiGame } from '../core/games';
import { countOf } from '../core/policy';
import { rememberDetectedUsername, rememberLastGameEnd } from './storage';
import { syncDay } from './sync';

const ME = 'crabinloan';
const NOON = new Date('2026-08-08T12:00:00');

function response(body: unknown, status = 200, lastModified?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (h: string) => (h === 'last-modified' ? (lastModified ?? null) : null) },
  } as Response;
}

function apiGame(id: string, overrides: Partial<ApiGame> = {}): ApiGame {
  return {
    url: `https://www.chess.com/game/live/${id}`,
    time_class: 'bullet',
    end_time: Math.floor(NOON.getTime() / 1000) - 600,
    white: { username: ME, result: 'win' },
    black: { username: 'Rival', result: 'resigned' },
    ...overrides,
  };
}

const archive = (...games: ApiGame[]) => vi.fn().mockResolvedValue(response({ games }));
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
      'https://api.chess.com/pub/player/crabinloan/games/2026/08',
      expect.anything(),
    );
  });

  describe('caching', () => {
    it('does not ask again within the TTL', async () => {
      const fetchImpl = archive(apiGame('1'));
      await sync(fetchImpl);
      await sync(fetchImpl);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('`force` skips the TTL', async () => {
      const fetchImpl = archive(apiGame('1'));
      await sync(fetchImpl);
      await sync(fetchImpl, true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('asks again once the TTL is past', async () => {
      const fetchImpl = archive(apiGame('1'));
      await sync(fetchImpl);
      const later = NOON.getTime() + 20_000;
      vi.setSystemTime(later);
      await syncDay({ now: later, fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('a 304 does not empty the count', async () => {
      await sync(
        vi.fn().mockResolvedValue(response({ games: [apiGame('1')] }, 200, 'stamp')),
        true,
      );
      const outcome = await sync(vi.fn().mockResolvedValue(response(null, 304)), true);
      expect(countOf(outcome.state, 'bullet')).toBe(1);
    });
  });

  // An empty list from a failure would look like "no games today" and lift the block.
  describe('when the API fails', () => {
    it('keeps the last thing it knew', async () => {
      await sync(archive(apiGame('1'), apiGame('2')), true);
      const outcome = await sync(vi.fn().mockResolvedValue(response({}, 500)), true);
      expect(outcome).toMatchObject({ ok: false, reason: 'network-error' });
      expect(countOf(outcome.state, 'bullet')).toBe(2);
    });

    it('with nothing stored it lets you through rather than blocking blind', async () => {
      const outcome = await sync(vi.fn().mockResolvedValue(response({}, 500)));
      expect(countOf(outcome.state, 'bullet')).toBe(0);
    });
  });

  /**
   * The snapshot is keyed by account, stamps included. Without that, the old account's
   * If-Modified-Since could 304 against the new account's archive and keep counting
   * games the new account never played.
   */
  it('an account switch drops the snapshot and its stamps', async () => {
    await sync(vi.fn().mockResolvedValue(response({ games: [apiGame('1')] }, 200, 'stamp')), true);

    await rememberDetectedUsername('someone-else');
    const fetchImpl = archive();
    const outcome = await sync(fetchImpl, true);

    expect(countOf(outcome.state, 'bullet')).toBe(0);
    // Asked fresh, not conditionally: the stamp belonged to the previous account.
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), { headers: {}, cache: 'no-store' });
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
    const outcome = await sync(vi.fn().mockResolvedValue(response({}, 500)), true);
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
