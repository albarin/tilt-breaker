import { describe, expect, it } from 'vitest';
import { countOf, evaluate, lossStreakOf, summarize } from './policy';
import {
  COOLDOWN_MINUTES,
  DEFAULT_SETTINGS,
  type DayState,
  type GameRecord,
  type GameResult,
  type Settings,
  type GameType,
} from './types';

const DAY = '2026-08-08';
const at = (iso: string) => new Date(iso).getTime();
const NOON = at('2026-08-08T12:00:00');

let nextId = 0;

function game(gameType: GameType, result: GameResult, endedAt: number): GameRecord {
  return { id: `g${nextId++}`, gameType, startedAt: endedAt, endedAt, result };
}

function stateWith(games: GameRecord[]): DayState {
  return { dayKey: DAY, games: Object.fromEntries(games.map((g) => [g.id, g])) };
}

function settingsWith(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** N games of one game type, one minute apart. */
function streak(gameType: GameType, results: GameResult[], from = NOON) {
  return results.map((r, i) => game(gameType, r, from + i * 60_000));
}

describe('countOf', () => {
  it('counts per game type and does not mix them', () => {
    const state = stateWith([...streak('blitz', ['win', 'loss']), ...streak('rapid', ['win'])]);
    expect(countOf(state, 'blitz')).toBe(2);
    expect(countOf(state, 'rapid')).toBe(1);
    expect(countOf(state, 'bullet')).toBe(0);
  });
});

describe('lossStreakOf', () => {
  it('counts the losses at the end', () => {
    expect(lossStreakOf(stateWith(streak('blitz', ['win', 'loss', 'loss'])), 'blitz').losses).toBe(
      2,
    );
  });

  it('a win breaks the streak', () => {
    expect(lossStreakOf(stateWith(streak('blitz', ['loss', 'loss', 'win'])), 'blitz').losses).toBe(
      0,
    );
  });

  // Draws were the case DOM scraping could not tell apart: chess.com puts no draw
  // modifier on the modal, but the API names them.
  it('a draw breaks the streak too', () => {
    expect(lossStreakOf(stateWith(streak('blitz', ['loss', 'loss', 'draw'])), 'blitz').losses).toBe(
      0,
    );
  });

  it('streaks are independent per game type', () => {
    const state = stateWith([
      ...streak('blitz', ['loss', 'loss', 'loss']),
      ...streak('rapid', ['win'], NOON + 10 * 60_000),
    ]);
    expect(lossStreakOf(state, 'blitz').losses).toBe(3);
    expect(lossStreakOf(state, 'rapid').losses).toBe(0);
  });
});

describe('evaluate', () => {
  it('allows while the quota lasts', () => {
    const state = stateWith(streak('blitz', ['win', 'win']));
    expect(evaluate({ state, settings: settingsWith(), gameType: 'blitz', now: NOON })).toEqual({
      allow: true,
    });
  });

  it('blocks on reaching the quota', () => {
    const state = stateWith(streak('blitz', ['win', 'win', 'win']));
    const settings = settingsWith({ limits: { bullet: 3, blitz: 3, rapid: null } });
    expect(evaluate({ state, settings, gameType: 'blitz', now: NOON })).toMatchObject({
      allow: false,
      reason: 'quota',
      used: 3,
      limit: 3,
    });
  });

  it('a null quota never blocks', () => {
    const state = stateWith(streak('rapid', ['win', 'win', 'win', 'win', 'win', 'win']));
    const settings = settingsWith({ limits: { bullet: 3, blitz: 3, rapid: null } });
    expect(evaluate({ state, settings, gameType: 'rapid', now: NOON }).allow).toBe(true);
  });

  /** A quota of 0 means "none at all today", blocked from the very first game. */
  it('a quota of zero blocks before you play anything', () => {
    const settings = settingsWith({ limits: { bullet: 0, blitz: 5, rapid: null } });
    expect(
      evaluate({ state: stateWith([]), settings, gameType: 'bullet', now: NOON }),
    ).toMatchObject({ allow: false, reason: 'quota', used: 0, limit: 0 });
  });

  it('spending blitz leaves rapid alone', () => {
    const state = stateWith(streak('blitz', ['win', 'win', 'win']));
    const settings = settingsWith({ limits: { bullet: 3, blitz: 3, rapid: null } });
    expect(evaluate({ state, settings, gameType: 'blitz', now: NOON }).allow).toBe(false);
    expect(evaluate({ state, settings, gameType: 'rapid', now: NOON }).allow).toBe(true);
  });

  describe('losing streak', () => {
    const settings = settingsWith({
      limits: { bullet: null, blitz: null, rapid: null },
      tilt: { losses: 3 },
    });
    const games = streak('blitz', ['loss', 'loss', 'loss']);
    const lastLoss = games[2]!.endedAt;

    it('blocks during the cooldown', () => {
      const now = lastLoss + (COOLDOWN_MINUTES / 2) * 60_000;
      expect(evaluate({ state: stateWith(games), settings, gameType: 'blitz', now })).toMatchObject(
        { allow: false, reason: 'tilt', losses: 3 },
      );
    });

    it('allows once the cooldown expires', () => {
      const now = lastLoss + (COOLDOWN_MINUTES + 1) * 60_000;
      expect(evaluate({ state: stateWith(games), settings, gameType: 'blitz', now }).allow).toBe(
        true,
      );
    });
  });

  // If the day is already spent, "wait 60 minutes" would be a lie.
  it('quota outranks the streak when explaining the block', () => {
    const games = streak('blitz', ['loss', 'loss', 'loss']);
    const settings = settingsWith({ limits: { bullet: 3, blitz: 3, rapid: null } });
    const now = games[2]!.endedAt + 10 * 60_000;
    expect(evaluate({ state: stateWith(games), settings, gameType: 'blitz', now })).toMatchObject({
      allow: false,
      reason: 'quota',
    });
  });
});

describe('summarize', () => {
  it('returns one row per game type', () => {
    const state = stateWith(streak('blitz', ['win', 'loss']));
    const settings = settingsWith({ limits: { bullet: 8, blitz: 6, rapid: 3 } });
    const rows = summarize(state, settings, NOON);
    expect(rows.map((r) => r.gameType)).toEqual(['bullet', 'blitz', 'rapid']);
    expect(rows.find((r) => r.gameType === 'blitz')).toMatchObject({
      used: 2,
      limit: 6,
      lossStreak: 1,
    });
  });
});

describe('gap between games', () => {
  const settings = settingsWith({
    limits: { bullet: null, blitz: null, rapid: null },
    gapMinutes: 15,
  });
  const withLastGame = (endedAt: number): DayState => ({
    ...stateWith([]),
    lastGameEndedAt: endedAt,
  });

  it('blocks until the gap has passed', () => {
    const state = withLastGame(NOON);
    expect(evaluate({ state, settings, gameType: 'blitz', now: NOON + 5 * 60_000 })).toMatchObject({
      allow: false,
      reason: 'gap',
      until: NOON + 15 * 60_000,
    });
  });

  it('allows once it has', () => {
    const state = withLastGame(NOON);
    expect(evaluate({ state, settings, gameType: 'blitz', now: NOON + 16 * 60_000 }).allow).toBe(
      true,
    );
  });

  /** Per-type would be walked around by alternating bullet and blitz. */
  it('is global: a bullet game holds blitz back too', () => {
    const state = withLastGame(NOON);
    for (const gameType of ['bullet', 'blitz', 'rapid'] as const) {
      expect(evaluate({ state, settings, gameType, now: NOON + 60_000 }).allow, gameType).toBe(
        false,
      );
    }
  });

  it('zero minutes switches it off', () => {
    const state = withLastGame(NOON);
    const off = settingsWith({ limits: { bullet: null, blitz: null, rapid: null }, gapMinutes: 0 });
    expect(evaluate({ state, settings: off, gameType: 'blitz', now: NOON }).allow).toBe(true);
  });

  it('does nothing with no game on record', () => {
    expect(evaluate({ state: stateWith([]), settings, gameType: 'blitz', now: NOON }).allow).toBe(
      true,
    );
  });

  /**
   * It survives the day rollover: `lastGameEndedAt` is kept apart from `games`, which
   * reset at midnight. Finishing at 23:58 must still hold you back at 00:05.
   */
  it('holds across midnight, when today has no games yet', () => {
    const lastNight = new Date('2026-08-07T23:58:00').getTime();
    const justAfter = new Date('2026-08-08T00:05:00').getTime();
    const state: DayState = { dayKey: DAY, games: {}, lastGameEndedAt: lastNight };
    expect(evaluate({ state, settings, gameType: 'blitz', now: justAfter })).toMatchObject({
      allow: false,
      reason: 'gap',
    });
  });

  // Otherwise you would be told 21:30, come back, and be told 21:34.
  it('when the streak and the gap overlap it reports whichever ends later', () => {
    const both = settingsWith({
      limits: { bullet: null, blitz: null, rapid: null },
      tilt: { losses: 3 },
      gapMinutes: 15,
    });
    // Three losses ending an hour ago: the tilt cooldown is nearly over. A win a minute
    // ago means the gap runs later.
    const losses = streak('blitz', ['loss', 'loss', 'loss'], NOON - 59 * 60_000);
    const state: DayState = { ...stateWith(losses), lastGameEndedAt: NOON - 60_000 };
    const decision = evaluate({ state, settings: both, gameType: 'blitz', now: NOON });
    expect(decision).toMatchObject({ allow: false, reason: 'gap' });
  });

  // The day being over is not a wait: telling you to hold on 15 minutes would be a lie.
  it('a spent quota outranks the gap', () => {
    const spent = settingsWith({ limits: { bullet: null, blitz: 1, rapid: null }, gapMinutes: 15 });
    const state: DayState = {
      ...stateWith(streak('blitz', ['win'])),
      lastGameEndedAt: NOON,
    };
    expect(evaluate({ state, settings: spent, gameType: 'blitz', now: NOON })).toMatchObject({
      allow: false,
      reason: 'quota',
    });
  });

  /**
   * The gap blocks every type at once, so repeating it on all three rows would say the
   * same thing three times. The popup shows it once instead.
   */
  it('does not leak into the popup rows', () => {
    const state = withLastGame(NOON);
    const rows = summarize(state, settings, NOON + 60_000);
    expect(rows.every((r) => r.decision.allow)).toBe(true);
  });
});
