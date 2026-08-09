import { describe, expect, it } from 'vitest';
import { dayEndMs, dayKeyOf, dayStartMs } from './day';

// These tests assume TZ=Europe/Madrid (set by the `test` script in package.json).
const at = (iso: string) => new Date(iso).getTime();
const HOUR = 3_600_000;

describe('dayKeyOf', () => {
  it('splits the day exactly at the reset hour', () => {
    expect(dayKeyOf(at('2026-08-08T00:00:00'), 0)).toBe('2026-08-08');
    expect(dayKeyOf(at('2026-08-08T23:59:00'), 0)).toBe('2026-08-08');
  });

  it('puts the small hours in the previous day when the reset is later', () => {
    expect(dayKeyOf(at('2026-08-08T03:59:00'), 4)).toBe('2026-08-07');
    expect(dayKeyOf(at('2026-08-08T04:00:00'), 4)).toBe('2026-08-08');
  });

  it('crosses month and year boundaries', () => {
    expect(dayKeyOf(at('2026-09-01T02:00:00'), 4)).toBe('2026-08-31');
    expect(dayKeyOf(at('2027-01-01T01:00:00'), 4)).toBe('2026-12-31');
  });
});

describe('dayStartMs / dayEndMs', () => {
  it('one day ends where the next begins', () => {
    expect(dayEndMs('2026-08-07', 0)).toBe(dayStartMs('2026-08-08', 0));
  });

  it('every instant of a day falls inside its window', () => {
    const ts = at('2026-08-08T03:00:00');
    const key = dayKeyOf(ts, 0);
    expect(ts).toBeGreaterThanOrEqual(dayStartMs(key, 0));
    expect(ts).toBeLessThan(dayEndMs(key, 0));
  });

  /**
   * Why the arithmetic is wall-clock: the cut stays pinned to the same local hour even
   * though the day itself lasts 23 or 25 hours.
   */
  it('the spring-forward day lasts 23 hours and still cuts at the reset hour', () => {
    const start = dayStartMs('2026-03-29', 0);
    const end = dayEndMs('2026-03-29', 0);
    expect(end - start).toBe(23 * HOUR);
    expect(new Date(end).getHours()).toBe(0);
  });

  it('the fall-back day lasts 25 hours and still cuts at the reset hour', () => {
    const start = dayStartMs('2026-10-25', 0);
    const end = dayEndMs('2026-10-25', 0);
    expect(end - start).toBe(25 * HOUR);
    expect(new Date(end).getHours()).toBe(0);
  });
});
