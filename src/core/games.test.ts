import { describe, expect, it } from 'vitest';
import { gamesForDay, lastGameEnd, parseGameId, toRecord, toRecords, type ApiGame } from './games';

const ME = 'crabinloan';
const at = (iso: string) => new Date(iso).getTime();
const DAY_START = at('2026-08-08T00:00:00');
const DAY_END = at('2026-08-09T00:00:00');
const NOON = at('2026-08-08T12:00:00');

function apiGame(id: string, overrides: Partial<ApiGame> = {}): ApiGame {
  return {
    url: `https://www.chess.com/game/live/${id}`,
    time_class: 'blitz',
    end_time: Math.floor(NOON / 1000),
    white: { username: ME, result: 'win' },
    black: { username: 'Rival', result: 'resigned' },
    ...overrides,
  };
}

const build = (apiGames: ApiGame[]) =>
  gamesForDay({ records: toRecords(apiGames, ME), dayStart: DAY_START, dayEnd: DAY_END });

/** One of yours, ended `minutes` past noon, leaving you on `rating`. */
function played(
  id: string,
  minutes: number,
  rating: number | undefined,
  overrides: Partial<ApiGame> = {},
): ApiGame {
  return apiGame(id, {
    end_time: Math.floor(NOON / 1000) + minutes * 60,
    white: { username: ME, result: 'win', ...(rating === undefined ? {} : { rating }) },
    ...overrides,
  });
}

const deltas = (apiGames: ApiGame[]) =>
  toRecords(apiGames, ME)
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((record) => record.ratingDelta);

describe('parseGameId', () => {
  /** Both shapes are real and come from the same game: live play and the archive. */
  it('accepts both URL shapes', () => {
    expect(parseGameId('https://www.chess.com/game/172719499530')).toBe('172719499530');
    expect(parseGameId('https://www.chess.com/game/live/172348397066')).toBe('172348397066');
  });

  it('ignores anything that is not a game', () => {
    expect(parseGameId('https://www.chess.com/member/alba')).toBeNull();
  });
});

describe('toRecord', () => {
  it('maps the result of whichever side is yours', () => {
    expect(toRecord(apiGame('1'), ME)?.result).toBe('win');
    expect(
      toRecord(
        apiGame('2', {
          white: { username: 'Rival', result: 'win' },
          black: { username: ME, result: 'checkmated' },
        }),
        ME,
      )?.result,
    ).toBe('loss');
  });

  it('recognises draws by their code', () => {
    ['agreed', 'repetition', 'stalemate', 'insufficient', '50move'].forEach((code, i) => {
      const game = apiGame(`100${i}`, {
        white: { username: ME, result: code },
        black: { username: 'Rival', result: code },
      });
      expect(toRecord(game, ME)?.result, code).toBe('draw');
    });
  });

  it('treats every other code as a loss', () => {
    ['checkmated', 'resigned', 'timeout', 'abandoned', 'lose'].forEach((code, i) => {
      const game = apiGame(`200${i}`, {
        white: { username: ME, result: code },
        black: { username: 'Rival', result: 'win' },
      });
      expect(toRecord(game, ME)?.result, code).toBe('loss');
    });
  });

  it('compares usernames case-insensitively', () => {
    const game = apiGame('3', { white: { username: 'CrabInLoan', result: 'win' } });
    expect(toRecord(game, 'crabinloan')?.result).toBe('win');
  });

  it('drops correspondence', () => {
    expect(toRecord(apiGame('4', { time_class: 'daily' }), ME)).toBeNull();
  });

  it('drops games you did not play', () => {
    const game = apiGame('5', {
      white: { username: 'Uno', result: 'win' },
      black: { username: 'Otro', result: 'resigned' },
    });
    expect(toRecord(game, ME)).toBeNull();
  });
});

describe('gamesForDay', () => {
  it('keys by id, so re-reading the archive never double-counts', () => {
    expect(Object.keys(build([apiGame('1'), apiGame('1'), apiGame('2')])).sort()).toEqual([
      '1',
      '2',
    ]);
  });

  it('drops whatever falls outside the day window', () => {
    const yesterday = apiGame('301', { end_time: Math.floor(at('2026-08-07T22:00:00') / 1000) });
    const tomorrow = apiGame('302', { end_time: Math.floor(at('2026-08-09T01:00:00') / 1000) });
    expect(Object.keys(build([yesterday, tomorrow, apiGame('303')]))).toEqual(['303']);
  });

  it('the window is closed below and open above', () => {
    const first = apiGame('401', { end_time: DAY_START / 1000 });
    const last = apiGame('402', { end_time: DAY_END / 1000 });
    expect(Object.keys(build([first, last]))).toEqual(['401']);
  });
});

describe('toRecords', () => {
  /** The filtering both readings rely on, now done once instead of once each. */
  it('keeps your live games and drops the rest', () => {
    const theirs = apiGame('1', {
      white: { username: 'Uno', result: 'win' },
      black: { username: 'Otro', result: 'resigned' },
    });
    const correspondence = apiGame('2', { time_class: 'daily' });
    expect(toRecords([theirs, correspondence, apiGame('3')], ME).map((r) => r.id)).toEqual(['3']);
  });
});

/**
 * The archive reports the rating a game left you on and never the change, so every delta
 * here is a subtraction against the game before it. That is the whole reason this is done
 * over the archive instead of over a day.
 */
describe('rating deltas', () => {
  it('measures each game against the one before it', () => {
    expect(deltas([played('1', 0, 1200), played('2', 5, 1208), played('3', 10, 1201)])).toEqual([
      undefined,
      8,
      -7,
    ]);
  });

  /** The archive may hand them over in any order; the chain is by time, not by position. */
  it('does not care what order the archive is in', () => {
    expect(deltas([played('3', 10, 1201), played('1', 0, 1200), played('2', 5, 1208)])).toEqual([
      undefined,
      8,
      -7,
    ]);
  });

  /** Ratings are per game type, so a blitz game must never be measured against a rapid one. */
  it('keeps the game types apart', () => {
    const games = [
      played('1', 0, 1200),
      played('2', 5, 900, { time_class: 'rapid' }),
      played('3', 10, 1210),
      played('4', 15, 890, { time_class: 'rapid' }),
    ];
    expect(deltas(games)).toEqual([undefined, undefined, 10, -10]);
  });

  /**
   * An unrated game is the one case where zero is a fact rather than a guess: it moved
   * nothing. It must also not become the mark the next game is measured against, or that
   * game would be credited with the change this one did not make.
   */
  it('counts an unrated game as no change, and does not chain through it', () => {
    const games = [
      played('1', 0, 1200),
      played('2', 5, 1200, { rated: false }),
      played('3', 10, 1206),
    ];
    expect(deltas(games)).toEqual([undefined, 0, 6]);
  });

  /**
   * The first game of the archive has nothing behind it to subtract. It keeps no delta
   * rather than a zero, because a zero would read as "you held your rating" on what is
   * really "we cannot see back that far".
   */
  it('leaves the earliest game unmeasured rather than calling it zero', () => {
    expect(deltas([played('1', 0, 1200)])).toEqual([undefined]);
  });

  /**
   * A missing rating breaks the chain rather than being skipped over. Measuring the next
   * game against the last rating we did see would hand it two games' worth of change.
   */
  it('leaves a game the archive gave no rating for unmeasured, and the one after it too', () => {
    const games = [played('1', 0, 1200), played('2', 5, undefined), played('3', 10, 1206)];
    expect(deltas(games)).toEqual([undefined, undefined, undefined]);
  });
});

describe('lastGameEnd', () => {
  const ends = (apiGames: ApiGame[]) => lastGameEnd(toRecords(apiGames, ME));

  /** Deliberately unfiltered by day, so the gap between games survives midnight. */
  it('takes the latest end regardless of the day window', () => {
    const older = apiGame('1', { end_time: Math.floor(at('2026-08-07T23:00:00') / 1000) });
    const newer = apiGame('2', { end_time: Math.floor(at('2026-08-08T02:00:00') / 1000) });
    expect(ends([older, newer])).toBe(at('2026-08-08T02:00:00'));
  });

  it('ignores games that are not yours', () => {
    const theirs = apiGame('1', {
      white: { username: 'Uno', result: 'win' },
      black: { username: 'Otro', result: 'resigned' },
    });
    expect(ends([theirs])).toBeNull();
  });

  it('ignores correspondence', () => {
    expect(ends([apiGame('1', { time_class: 'daily' })])).toBeNull();
  });

  it('is null with nothing to look at', () => {
    expect(ends([])).toBeNull();
  });
});
