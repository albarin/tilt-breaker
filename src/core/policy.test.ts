import { describe, expect, it } from 'vitest';
import { countOf, evaluate, lossStreakOf, ratingDeltaOf, summarize, tallyOf } from './policy';
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

function game(
  gameType: GameType,
  result: GameResult,
  endedAt: number,
  ratingDelta?: number,
): GameRecord {
  return {
    id: `g${nextId++}`,
    gameType,
    endedAt,
    result,
    ...(ratingDelta === undefined ? {} : { ratingDelta }),
  };
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

describe('tallyOf', () => {
  it('splits the count into wins, losses and draws', () => {
    const state = stateWith(streak('blitz', ['win', 'loss', 'draw', 'loss']));
    expect(tallyOf(state, 'blitz')).toEqual({ wins: 1, losses: 2, draws: 1 });
  });

  it('adds up to the count, per game type', () => {
    const state = stateWith([
      ...streak('blitz', ['win', 'loss', 'draw']),
      ...streak('rapid', ['win'], NOON + 10 * 60_000),
    ]);
    const blitz = tallyOf(state, 'blitz');
    expect(blitz.wins + blitz.losses + blitz.draws).toBe(countOf(state, 'blitz'));
    expect(tallyOf(state, 'rapid')).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(tallyOf(state, 'bullet')).toEqual({ wins: 0, losses: 0, draws: 0 });
  });
});

describe('ratingDeltaOf', () => {
  it('adds up the day, per game type', () => {
    const state = stateWith([
      game('blitz', 'win', NOON, 8),
      game('blitz', 'loss', NOON + 60_000, -7),
      game('rapid', 'win', NOON + 120_000, 6),
    ]);
    expect(ratingDeltaOf(state, 'blitz')).toBe(1);
    expect(ratingDeltaOf(state, 'rapid')).toBe(6);
  });

  /** No games is not "unknown": nothing was played, so nothing moved. */
  it('is zero on a day with no games', () => {
    expect(ratingDeltaOf(stateWith([]), 'blitz')).toBe(0);
  });

  it('carries a losing day as a negative', () => {
    const state = stateWith([game('blitz', 'loss', NOON, -8), game('blitz', 'loss', NOON, -9)]);
    expect(ratingDeltaOf(state, 'blitz')).toBe(-17);
  });

  /**
   * The one that matters. A day missing one game's change must not report the sum of the
   * rest: it would look like a full answer while being exactly one game wrong, and the
   * game it is missing is as likely as not the one you opened the popup about.
   */
  it('refuses the whole day when one game cannot be measured', () => {
    const state = stateWith([
      game('blitz', 'win', NOON, 8),
      game('blitz', 'loss', NOON + 60_000),
      game('blitz', 'win', NOON + 120_000, 7),
    ]);
    expect(ratingDeltaOf(state, 'blitz')).toBeNull();
  });

  // An unmeasurable game in one type says nothing about another.
  it('refuses only the game type that is short', () => {
    const state = stateWith([game('blitz', 'win', NOON), game('rapid', 'win', NOON, 6)]);
    expect(ratingDeltaOf(state, 'blitz')).toBeNull();
    expect(ratingDeltaOf(state, 'rapid')).toBe(6);
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
      tally: { wins: 1, losses: 1, draws: 0 },
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

/**
 * A settings field can be emptied, and `Number('')` is `0`. Neither rule may turn that
 * into "block always"; both treat a nonsensical value as switched off.
 */
describe('nonsensical settings', () => {
  const games = streak('blitz', ['loss']);
  const state: DayState = { ...stateWith(games), lastGameEndedAt: NOON };
  const now = NOON + 60_000;

  it('a losing-streak threshold below one does not block after a single loss', () => {
    for (const losses of [0, -3]) {
      const settings = settingsWith({
        limits: { bullet: null, blitz: null, rapid: null },
        tilt: { losses },
        gapMinutes: 0,
      });
      expect(evaluate({ state, settings, gameType: 'blitz', now }).allow, `losses=${losses}`).toBe(
        true,
      );
    }
  });

  it('a threshold of one still blocks after a single loss, as asked', () => {
    const settings = settingsWith({
      limits: { bullet: null, blitz: null, rapid: null },
      tilt: { losses: 1 },
      gapMinutes: 0,
    });
    expect(evaluate({ state, settings, gameType: 'blitz', now })).toMatchObject({
      allow: false,
      reason: 'tilt',
    });
  });

  it('a gap that is not a number does not block', () => {
    const settings = settingsWith({
      limits: { bullet: null, blitz: null, rapid: null },
      tilt: { losses: 3 },
      gapMinutes: Number.NaN,
    });
    expect(evaluate({ state, settings, gameType: 'blitz', now }).allow).toBe(true);
  });
});

/**
 * The bug a user hit: rapid games back to back with a 5-minute gap configured.
 *
 * The gap runs from the last game's end, which comes from the archive — and the archive
 * takes a few seconds to publish a game. Until it does, the stored end is the *previous*
 * game's.
 *
 * Short games hid this: the previous bullet game ended a couple of minutes ago, so the
 * stale gap was still running and blocked by accident. After a 20-minute rapid the stale
 * gap has long expired and nothing stands in the way.
 */
describe('gap while the archive catches up', () => {
  const settings = settingsWith({
    limits: { bullet: null, blitz: null, rapid: null },
    gapMinutes: 5,
  });
  const allows = (lastGameEndedAt: number, now: number) =>
    evaluate({ state: { ...stateWith([]), lastGameEndedAt }, settings, gameType: 'rapid', now })
      .allow;

  it('a stale end from a long game leaves nothing blocking', () => {
    // What the extension knew before the just-finished game reached the archive.
    expect(allows(NOON - 20 * 60_000, NOON)).toBe(true);
  });

  it('reporting the end at once is what closes it', () => {
    // The content script reports the finish immediately, so the gap runs from now.
    expect(allows(NOON, NOON + 60_000)).toBe(false);
    expect(allows(NOON, NOON + 6 * 60_000)).toBe(true);
  });

  // Why short games never showed it.
  it('after a short game the stale end blocked by accident', () => {
    expect(allows(NOON - 2 * 60_000, NOON)).toBe(false);
  });
});

/**
 * A game chess.com's own record counts and the archive has not published yet. It has no
 * id, no result and no clock — `/stats` reports totals, not games — so it can be counted
 * and nothing else. See `pending` on `DayState`.
 */
describe('games still on their way', () => {
  const waiting = (games: GameRecord[], pending: Partial<Record<GameType, number>>): DayState => ({
    ...stateWith(games),
    pending,
  });

  it('counts against the quota like any other game', () => {
    const state = waiting([game('blitz', 'win', NOON)], { blitz: 2 });
    expect(countOf(state, 'blitz')).toBe(3);
  });

  /** The block is the whole point: an archive that is late must not hand back a free game. */
  it('spends the last of a limit', () => {
    const state = waiting([game('blitz', 'win', NOON)], { blitz: 1 });
    const settings = settingsWith({ limits: { ...DEFAULT_SETTINGS.limits, blitz: 2 } });

    expect(evaluate({ state, settings, gameType: 'blitz', now: NOON })).toMatchObject({
      allow: false,
      reason: 'quota',
      used: 2,
    });
  });

  it('leaves the other game types alone', () => {
    const state = waiting([], { blitz: 2 });
    expect(countOf(state, 'bullet')).toBe(0);
  });

  /** It has no result, so it belongs in none of the three columns. */
  it('is not filed as a win, a loss or a draw', () => {
    const state = waiting([game('blitz', 'win', NOON)], { blitz: 2 });
    expect(tallyOf(state, 'blitz')).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  /**
   * A total quietly missing a game still looks like an answer, and the missing one is the
   * game you opened the popup to ask about.
   */
  it("leaves the day's rating untold rather than short", () => {
    const state = waiting([game('blitz', 'loss', NOON, -8)], { blitz: 1 });
    expect(ratingDeltaOf(state, 'blitz')).toBeNull();
  });

  /**
   * A streak is made of results and this game has none, so a cooldown can arrive a few
   * seconds late — when the archive publishes the loss that completed it. The quota, which
   * does count the game, is what holds the line meanwhile.
   */
  it('does not extend a losing streak on a guess', () => {
    const state = waiting([game('blitz', 'loss', NOON), game('blitz', 'loss', NOON + 1)], {
      blitz: 1,
    });
    expect(lossStreakOf(state, 'blitz').losses).toBe(2);
  });

  /** The popup has to render it, or the row will not add up: 3 played, one W, and no more. */
  it('is reported on the row so the count adds up on screen', () => {
    const state = waiting([game('blitz', 'win', NOON)], { blitz: 2 });
    const row = summarize(state, settingsWith(), NOON).find((r) => r.gameType === 'blitz');

    expect(row).toMatchObject({ used: 3, pending: 2 });
    expect(row!.tally.wins + row!.tally.draws + row!.tally.losses + row!.pending).toBe(row!.used);
  });
});
