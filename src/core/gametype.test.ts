import { describe, expect, it } from 'vitest';
import { classify, gameTypeFromLabel } from './gametype';

describe('classify', () => {
  it('cuts at 180 and 600 estimated seconds', () => {
    expect(classify({ base: 179, increment: 0 })).toBe('bullet');
    expect(classify({ base: 180, increment: 0 })).toBe('blitz');
    expect(classify({ base: 599, increment: 0 })).toBe('blitz');
    expect(classify({ base: 600, increment: 0 })).toBe('rapid');
  });

  it('counts the increment over 40 moves', () => {
    expect(classify({ base: 60, increment: 1 })).toBe('bullet'); // 1|1 → 100s
    expect(classify({ base: 120, increment: 1 })).toBe('bullet'); // 2|1 → 160s
    expect(classify({ base: 120, increment: 2 })).toBe('blitz'); // 2|2 → 200s
    expect(classify({ base: 900, increment: 10 })).toBe('rapid'); // 15|10 → 1300s
  });
});

describe('gameTypeFromLabel', () => {
  // Labels copied verbatim from the chess.com lobby.
  it('reads the lobby labels, which are in minutes', () => {
    expect(gameTypeFromLabel('1 min')).toBe('bullet');
    expect(gameTypeFromLabel('1 + 1')).toBe('bullet');
    expect(gameTypeFromLabel('2 + 1')).toBe('bullet');
    expect(gameTypeFromLabel('3 min')).toBe('blitz');
    expect(gameTypeFromLabel('3 + 2')).toBe('blitz');
    expect(gameTypeFromLabel('5 min')).toBe('blitz');
    expect(gameTypeFromLabel('10 min')).toBe('rapid');
    expect(gameTypeFromLabel('10 + 5')).toBe('rapid');
    expect(gameTypeFromLabel('15 + 10')).toBe('rapid');
  });

  it('accepts the other separators the site uses elsewhere', () => {
    expect(gameTypeFromLabel('3 | 2')).toBe('blitz');
    expect(gameTypeFromLabel('1|0')).toBe('bullet');
  });

  it('returns null on anything it cannot read', () => {
    expect(gameTypeFromLabel('Partida amistosa')).toBeNull();
    expect(gameTypeFromLabel('')).toBeNull();
    expect(gameTypeFromLabel(null)).toBeNull();
    expect(gameTypeFromLabel(undefined)).toBeNull();
  });
});
