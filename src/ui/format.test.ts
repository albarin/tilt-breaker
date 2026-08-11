import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameTypeSummary } from '../core/policy';
import { catalogue } from '../test-setup';
import { blockReason, formatTime, usedFraction } from './format';

const at = (iso: string) => new Date(iso).getTime();

// The 12-hour case reloads the module and stubs the language; neither may outlive it.
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/**
 * `formatTime` as it would run for a user of that language, reading that catalogue.
 *
 * The module caches its formatter on first use, so this reloads it rather than
 * reassigning the language under a formatter that has already been built.
 */
async function speaking(language: string, locale: string) {
  vi.resetModules();
  vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue(language);
  vi.spyOn(browser.i18n, 'getMessage').mockImplementation(await catalogue(locale));
  const { formatTime: reloaded } = await import('./format');
  return reloaded;
}

function row(overrides: Partial<GameTypeSummary>): GameTypeSummary {
  return {
    gameType: 'blitz',
    used: 0,
    limit: 5,
    tally: { wins: 0, losses: 0, draws: 0 },
    lossStreak: 0,
    decision: { allow: true },
    ...overrides,
  };
}

describe('formatTime', () => {
  // `en-GB`, pinned by the test setup, is a 24-hour locale. The suffix that used to be
  // welded on here now lives in the catalogue, and English does not ask for one.
  it('formats the time in the UI language', () => {
    expect(formatTime(at('2026-08-09T04:00:00'))).toBe('04:00');
    expect(formatTime(at('2026-08-08T21:05:00'))).toBe('21:05');
  });

  // The clock shape is not ours to choose: a 12-hour locale must get a 12-hour time.
  it('follows a 12-hour locale', async () => {
    const formatTime = await speaking('en-US', 'en');

    expect(formatTime(at('2026-08-08T21:05:00'))).toMatch(/09:05\s?PM/i);
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
    expect(blockReason(row({ decision }))).toBe('resting until 21:30');
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
