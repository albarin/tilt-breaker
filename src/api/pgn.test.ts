import { describe, expect, it } from 'vitest';
import { gameTypeFromTimeControl, parseArchive } from './pgn';
import { toArchive, toPgn } from './pgn.fixture';
import type { ApiGame } from '../core/games';

const ME = 'crabinloan';
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function game(id: string, overrides: Partial<ApiGame> = {}): ApiGame {
  return {
    url: `https://www.chess.com/game/live/${id}`,
    time_class: 'blitz',
    end_time: at('2026-08-08T12:00:00Z'),
    white: { username: ME, result: 'win', rating: 1200 },
    black: { username: 'Rival', result: 'loss', rating: 1180 },
    ...overrides,
  };
}

describe('parseArchive', () => {
  it('reads a game back out of the PGN the server sends', () => {
    expect(parseArchive(toPgn(game('1')))).toEqual([game('1')]);
  });

  it('reads every game in a month, moves and blank lines and all', () => {
    const games = [game('1'), game('2'), game('3')];
    expect(parseArchive(toArchive(...games)).map((g) => g.url)).toEqual(games.map((g) => g.url));
  });

  it('is empty for an empty archive', () => {
    expect(parseArchive('')).toEqual([]);
  });

  /**
   * The score is the whole of what we read, and it is the same three symbols in every
   * language — unlike `[Termination]`, which is an English sentence.
   */
  describe('results', () => {
    it('reads a win for white', () => {
      const [parsed] = parseArchive(toPgn(game('1')));
      expect(parsed?.white.result).toBe('win');
      expect(parsed?.black.result).toBe('loss');
    });

    it('reads a win for black', () => {
      const black = game('1', {
        white: { username: ME, result: 'loss' },
        black: { username: 'Rival', result: 'win' },
      });
      const [parsed] = parseArchive(toPgn(black));
      expect(parsed?.white.result).toBe('loss');
      expect(parsed?.black.result).toBe('win');
    });

    it('reads a draw for both sides', () => {
      const drawn = game('1', {
        white: { username: ME, result: 'draw' },
        black: { username: 'Rival', result: 'draw' },
      });
      const [parsed] = parseArchive(toPgn(drawn));
      expect(parsed?.white.result).toBe('draw');
      expect(parsed?.black.result).toBe('draw');
    });

    /** `*` is a game still being played. It has no result, so it is not one to count. */
    it('drops a game still in progress', () => {
      expect(parseArchive(toPgn(game('1'), { Result: '*' }))).toEqual([]);
    });
  });

  describe('when it ended', () => {
    /** `[EndDate]`/`[EndTime]` are UTC, and the day they land on is the local one. */
    it('reads the end stamp as UTC', () => {
      const ended = at('2026-08-08T23:30:00Z');
      const [parsed] = parseArchive(toPgn(game('1', { end_time: ended })));
      expect(parsed?.end_time).toBe(ended);
    });

    /** The start is in the archive too, and taking it would date a long game hours early. */
    it('takes the end and not the start', () => {
      const pgn = toPgn(game('1'), { UTCTime: '10:00:00', EndTime: '12:00:00' });
      const [parsed] = parseArchive(pgn);
      expect(new Date((parsed?.end_time ?? 0) * 1000).toISOString()).toContain('T12:00:00');
    });

    it('drops a game with no readable end stamp', () => {
      expect(parseArchive(toPgn(game('1'), { EndTime: '' }))).toEqual([]);
    });
  });

  describe('ratings', () => {
    it('reads what each side was left on', () => {
      const [parsed] = parseArchive(toPgn(game('1')));
      expect(parsed?.white.rating).toBe(1200);
      expect(parsed?.black.rating).toBe(1180);
    });

    /** A rating we did not get must not become a zero: it leaves the delta unknown. */
    it('leaves out a rating the archive did not give', () => {
      const [parsed] = parseArchive(toPgn(game('1'), { WhiteElo: '' }));
      expect(parsed?.white).not.toHaveProperty('rating');
    });
  });

  /**
   * One bad block must not cost the month. `fetchMonth` turns a throw into "the API is
   * down", and a day that falls back to its last snapshot is a day that stops counting.
   */
  it('skips a game it cannot read and keeps the rest', () => {
    const broken = toPgn(game('2')).replace('[Link "https://www.chess.com/game/live/2"]', '');
    const parsed = parseArchive([toPgn(game('1')), broken, toPgn(game('3'))].join('\n'));
    expect(parsed.map((g) => g.url)).toEqual([
      'https://www.chess.com/game/live/1',
      'https://www.chess.com/game/live/3',
    ]);
  });
});

describe('gameTypeFromTimeControl', () => {
  it('classifies plain seconds', () => {
    expect(gameTypeFromTimeControl('60')).toBe('bullet');
    expect(gameTypeFromTimeControl('180')).toBe('blitz');
    expect(gameTypeFromTimeControl('900')).toBe('rapid');
  });

  /** The increment counts: `1|1` is bullet on the clock and blitz over forty moves. */
  it('counts the increment the way the lobby does', () => {
    expect(gameTypeFromTimeControl('60+0')).toBe('bullet');
    expect(gameTypeFromTimeControl('60+3')).toBe('blitz');
  });

  it('calls correspondence daily, whatever the days per move', () => {
    expect(gameTypeFromTimeControl('1/259200')).toBe('daily');
    expect(gameTypeFromTimeControl('1/86400')).toBe('daily');
  });

  /** Neither of these is a live game type, and neither is ever counted. */
  it('does not invent a game type it cannot read', () => {
    expect(gameTypeFromTimeControl('-')).toBe('unknown');
    expect(gameTypeFromTimeControl(undefined)).toBe('unknown');
  });
});
