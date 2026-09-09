import { describe, expect, it } from 'vitest';
import { parseJsonArchive } from './json';

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** One game as the JSON archive lists it, with only the fields the parser looks at. */
function jsonGame(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://www.chess.com/game/live/174228151658',
    time_control: '900+10',
    end_time: at('2026-09-08T20:40:44Z'),
    rated: true,
    time_class: 'rapid',
    rules: 'chess',
    white: { rating: 765, result: 'checkmated', username: 'crabinloan' },
    black: { rating: 800, result: 'win', username: 'caelum_x' },
    ...overrides,
  };
}

describe('parseJsonArchive', () => {
  it('reads a game the way the PGN parser would have', () => {
    expect(parseJsonArchive({ games: [jsonGame()] })).toEqual([
      {
        url: 'https://www.chess.com/game/live/174228151658',
        time_class: 'rapid',
        end_time: at('2026-09-08T20:40:44Z'),
        white: { username: 'crabinloan', result: 'loss', rating: 765 },
        black: { username: 'caelum_x', result: 'win', rating: 800 },
      },
    ]);
  });

  /**
   * Off the clock and not off the label, by the same rule the PGN is read with: one
   * function decides where bullet ends, and a game must read the same by either road.
   */
  it('classifies the game type from the time control, not the label', () => {
    const [game] = parseJsonArchive({
      games: [jsonGame({ time_control: '180+2', time_class: 'bullet' })],
    });
    expect(game?.time_class).toBe('blitz');
  });

  it('calls correspondence daily', () => {
    const [game] = parseJsonArchive({ games: [jsonGame({ time_control: '1/259200' })] });
    expect(game?.time_class).toBe('daily');
  });

  describe('results', () => {
    const resultOf = (white: string, black: string) =>
      parseJsonArchive({
        games: [
          jsonGame({
            white: { username: 'a', result: white },
            black: { username: 'b', result: black },
          }),
        ],
      }).map((g) => [g.white.result, g.black.result])[0];

    it('a win is a win and whatever faced it is a loss', () => {
      expect(resultOf('win', 'checkmated')).toEqual(['win', 'loss']);
      expect(resultOf('resigned', 'win')).toEqual(['loss', 'win']);
      expect(resultOf('timeout', 'win')).toEqual(['loss', 'win']);
      expect(resultOf('abandoned', 'win')).toEqual(['loss', 'win']);
    });

    it('reads every way a game can be drawn', () => {
      for (const code of [
        'agreed',
        'repetition',
        'stalemate',
        'insufficient',
        '50move',
        'timevsinsufficient',
      ]) {
        expect(resultOf(code, code)).toEqual(['draw', 'draw']);
      }
    });
  });

  it('leaves the rating out where the archive gave none', () => {
    const [game] = parseJsonArchive({
      games: [jsonGame({ white: { username: 'a', result: 'win' } })],
    });
    expect(game?.white).toEqual({ username: 'a', result: 'win' });
  });

  it('is empty for a month you did not play', () => {
    expect(parseJsonArchive({ games: [] })).toEqual([]);
    expect(parseJsonArchive({})).toEqual([]);
    expect(parseJsonArchive(null)).toEqual([]);
  });

  it('skips a game it cannot read and keeps the rest', () => {
    const games = parseJsonArchive({
      games: [jsonGame({ url: undefined }), jsonGame({ white: {} }), jsonGame()],
    });
    expect(games).toHaveLength(1);
  });
});
