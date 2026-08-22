import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameTypeSummary } from '../core/policy';
import { catalogue } from '../test-setup';
import { blockNote, formatRatingDelta, formatTime, pendingFraction, usedFraction } from './format';

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
    pending: 0,
    ratingDelta: 0,
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

  it('appends the suffix a language writes by convention', async () => {
    const formatTime = await speaking('es-ES', 'es');

    expect(formatTime(at('2026-08-08T21:05:00'))).toBe('21:05h');
  });

  /**
   * The two halves disagreeing is what this exists for. The browser picks the catalogue
   * by language, so `es-MX` reads the same Spanish strings as `es-ES`, `h` and all, while
   * `Intl` picks the clock by region and gives Latin America a 12-hour one. Appending
   * regardless produced "09:05 p.m.h" for a good share of the extension's Spanish users,
   * and no test in English could ever have seen it.
   */
  it('drops that suffix where the clock is not the one it belongs to', async () => {
    const formatTime = await speaking('es-MX', 'es');

    expect(formatTime(at('2026-08-08T21:05:00'))).toBe('09:05 p.m.');
  });
});

describe('formatRatingDelta', () => {
  it('carries the sign, because the number alone does not say which way', () => {
    expect(formatRatingDelta(12)).toBe('+12');
    expect(formatRatingDelta(-7)).toMatch(/^-7$/u);
  });

  /** "+0" reads like a gain too small to show. A day that ended level ended level. */
  it('leaves a level day unsigned', () => {
    expect(formatRatingDelta(0)).toBe('0');
  });

  /** Same lesson as the clock: the shape of a number is the reader's, not ours. */
  it('writes the number in the UI language', async () => {
    vi.resetModules();
    vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue('ar-EG');
    const { formatRatingDelta: reloaded } = await import('./format');

    expect(reloaded(12)).not.toBe('+12');
  });
});

describe('blockNote', () => {
  it('says nothing while you can play', () => {
    expect(blockNote(row({ used: 2 }))).toBeNull();
  });

  it('says until when, because that is the one thing the row cannot show', () => {
    const decision = {
      allow: false,
      reason: 'tilt',
      losses: 3,
      until: at('2026-08-08T21:30:00'),
    } as const;
    expect(blockNote(row({ decision }))).toBe('resting until 21:30');
  });

  /**
   * A spent quota writes nothing. The count reads 5/5 and the row is red, and a sentence
   * repeating that is a sentence per blocked type on the night they are all blocked.
   */
  it('leaves a spent quota to the colour and the count', () => {
    const decision = { allow: false, reason: 'quota', used: 5, limit: 5 } as const;
    expect(blockNote(row({ used: 5, decision }))).toBeNull();
  });

  /** A quota of zero is switched off rather than spent, and equally wordless. */
  it('leaves a quota of zero to them too', () => {
    const decision = { allow: false, reason: 'quota', used: 0, limit: 0 } as const;
    expect(blockNote(row({ limit: 0, decision }))).toBeNull();
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

/**
 * The tail of the bar, for games chess.com has counted and the archive has not published.
 * Drawn faded at the end of what is already spent, never as a slice of its own beyond it.
 */
describe('pendingFraction', () => {
  it('is the share of the bar those games account for', () => {
    expect(pendingFraction(row({ used: 4, limit: 8, pending: 1 }))).toBe(0.125);
    expect(pendingFraction(row({ used: 4, limit: 8, pending: 3 }))).toBe(0.375);
  });

  it('is nothing when the archive is level', () => {
    expect(pendingFraction(row({ used: 4, limit: 8, pending: 0 }))).toBe(0);
  });

  /** The two segments are the fill: together they are exactly `usedFraction`, never more. */
  it('never pushes the fill past the end of the bar', () => {
    const over = row({ used: 7, limit: 5, pending: 4 });
    expect(usedFraction(over)).toBe(1);
    expect(pendingFraction(over)).toBeLessThanOrEqual(1);
    expect(usedFraction(over) - pendingFraction(over)).toBeGreaterThanOrEqual(0);
  });

  it('has nothing to draw on a row with no limit', () => {
    expect(pendingFraction(row({ used: 9, limit: null, pending: 2 }))).toBe(0);
  });
});
