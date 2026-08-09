import { describe, expect, it } from 'vitest';
import type { GameTypeSummary } from '../core/policy';
import { blockReason, formatTime, usedFraction } from './format';

const at = (iso: string) => new Date(iso).getTime();

function row(overrides: Partial<GameTypeSummary>): GameTypeSummary {
  return {
    gameType: 'blitz',
    used: 0,
    limit: 5,
    lossStreak: 0,
    decision: { allow: true },
    ...overrides,
  };
}

describe('formatTime', () => {
  it('formats as 24-hour hh:mm with an h suffix', () => {
    expect(formatTime(at('2026-08-09T04:00:00'))).toBe('04:00h');
    expect(formatTime(at('2026-08-08T21:05:00'))).toBe('21:05h');
  });
});

describe('blockReason', () => {
  it('says nothing while you can play', () => {
    expect(blockReason(row({ used: 2 }))).toBeNull();
  });

  it('reports a spent quota', () => {
    const decision = { allow: false, reason: 'quota', used: 5, limit: 5 } as const;
    expect(blockReason(row({ used: 5, decision }))).toBe('done for today');
  });

  /**
   * A quota of 0 does not mean "you spent it", it means that game type is switched off
   * for the day. `used >= limit` blocks it from the first game, which is what we want;
   * what we must not do is word it as though you had played.
   */
  it('a quota of zero is disabled, not spent', () => {
    const decision = { allow: false, reason: 'quota', used: 0, limit: 0 } as const;
    expect(blockReason(row({ limit: 0, decision }))).toBe('off for today');
  });

  it('a streak says until when, because here waiting does help', () => {
    const decision = {
      allow: false,
      reason: 'tilt',
      losses: 3,
      until: at('2026-08-08T21:30:00'),
    } as const;
    expect(blockReason(row({ decision }))).toBe('resting until 21:30h');
  });
});

describe('usedFraction', () => {
  it('runs from empty to full as the quota is spent', () => {
    expect(usedFraction(row({ used: 0, limit: 4 }))).toBe(0);
    expect(usedFraction(row({ used: 1, limit: 4 }))).toBe(0.25);
    expect(usedFraction(row({ used: 4, limit: 4 }))).toBe(1);
  });

  // The API can return games we had not counted.
  it('going over the quota does not overflow the bar', () => {
    expect(usedFraction(row({ used: 7, limit: 5 }))).toBe(1);
  });

  it('a quota of zero renders full: there is nothing left to spend', () => {
    expect(usedFraction(row({ used: 0, limit: 0 }))).toBe(1);
  });

  it('no limit means nothing to fill', () => {
    expect(usedFraction(row({ used: 9, limit: null }))).toBe(0);
  });
});
