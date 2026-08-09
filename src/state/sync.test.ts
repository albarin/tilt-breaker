import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiGame } from '../core/games';
import { countOf } from '../core/policy';
import { rememberDetectedUsername } from './storage';
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
      await sync(vi.fn().mockResolvedValue(response({ games: [apiGame('1')] }, 200, 'stamp')), true);
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

  it('resets on its own when the day changes', async () => {
    await sync(archive(apiGame('1')));
    const tomorrow = new Date('2026-08-09T12:00:00').getTime();
    vi.setSystemTime(tomorrow);
    const outcome = await syncDay({ now: tomorrow, fetchImpl: archive() });
    expect(countOf(outcome.state, 'bullet')).toBe(0);
  });
});
