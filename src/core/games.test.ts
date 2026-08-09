import { describe, expect, it } from 'vitest';
import { gamesForDay, parseGameId, toRecord, type ApiGame } from './games';

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
  gamesForDay({ apiGames, username: ME, dayStart: DAY_START, dayEnd: DAY_END });

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
    expect(Object.keys(build([apiGame('1'), apiGame('1'), apiGame('2')])).sort()).toEqual(['1', '2']);
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
