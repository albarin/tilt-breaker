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
    expect(lossStreakOf(stateWith(streak('blitz', ['win', 'loss', 'loss'])), 'blitz').losses).toBe(2);
  });

  it('a win breaks the streak', () => {
    expect(lossStreakOf(stateWith(streak('blitz', ['loss', 'loss', 'win'])), 'blitz').losses).toBe(0);
  });

  // Draws were the case DOM scraping could not tell apart: chess.com puts no draw
  // modifier on the modal, but the API names them.
  it('a draw breaks the streak too', () => {
    expect(lossStreakOf(stateWith(streak('blitz', ['loss', 'loss', 'draw'])), 'blitz').losses).toBe(0);
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
    expect(evaluate({ state: stateWith([]), settings, gameType: 'bullet', now: NOON })).toMatchObject(
      { allow: false, reason: 'quota', used: 0, limit: 0 },
    );
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
    const rows = summarize(state, settingsWith(), NOON);
    expect(rows.map((r) => r.gameType)).toEqual(['bullet', 'blitz', 'rapid']);
    expect(rows.find((r) => r.gameType === 'blitz')).toMatchObject({
      used: 2,
      limit: 5,
      lossStreak: 1,
    });
  });
});
