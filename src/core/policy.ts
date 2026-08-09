import { COOLDOWN_MINUTES, GAME_TYPES, type DayState, type Settings, type GameType } from './types';

export type Decision =
  | { allow: true }
  | { allow: false; reason: 'quota'; used: number; limit: number }
  | { allow: false; reason: 'tilt'; losses: number; until: number }
  | { allow: false; reason: 'gap'; until: number };

/** A block with a time attached, which is every one of them except the quota. */
export type TimedBlock = Extract<Decision, { until: number }>;

/** Games of one game type, oldest first. */
function gamesOf(state: DayState, gameType: GameType) {
  return Object.values(state.games)
    .filter((g) => g.gameType === gameType)
    .sort((a, b) => a.endedAt - b.endedAt);
}

/** Counts are derived from the games, so they cannot drift out of sync on their own. */
export function countOf(state: DayState, gameType: GameType): number {
  return gamesOf(state, gameType).length;
}

/** Consecutive losses at the end of the day, and when the last one happened. */
export function lossStreakOf(
  state: DayState,
  gameType: GameType,
): { losses: number; lastLossAt: number | null } {
  let losses = 0;
  let lastLossAt: number | null = null;
  for (const game of gamesOf(state, gameType).reverse()) {
    if (game.result !== 'loss') break;
    losses++;
    lastLossAt ??= game.endedAt;
  }
  return { losses, lastLossAt };
}

/** Quota block for one game type, or `null` while it lasts. */
function quotaBlock(
  state: DayState,
  settings: Settings,
  gameType: GameType,
): Extract<Decision, { reason: 'quota' }> | null {
  const limit = settings.limits[gameType];
  const used = countOf(state, gameType);
  if (limit === null || used < limit) return null;
  return { allow: false, reason: 'quota', used, limit };
}

/**
 * Cooldown after a losing streak.
 *
 * It counts from the last loss, so every further loss re-arms it: come back the moment it
 * expires, lose again, and it starts over.
 */
function tiltBlock(
  state: DayState,
  settings: Settings,
  gameType: GameType,
  now: number,
): Extract<Decision, { reason: 'tilt' }> | null {
  // A threshold below one would mean "block after every single loss", which is never
  // what anyone meant: it is what an emptied settings field would leave behind.
  const threshold = settings.tilt.losses;
  if (!Number.isFinite(threshold) || threshold < 1) return null;

  const { losses, lastLossAt } = lossStreakOf(state, gameType);
  if (lastLossAt === null || losses < threshold) return null;
  const until = lastLossAt + COOLDOWN_MINUTES * 60_000;
  return now < until ? { allow: false, reason: 'tilt', losses, until } : null;
}

/**
 * Mandatory gap between games, counted from the last game of **any** type.
 *
 * Global on purpose: a per-type gap would be walked around by alternating bullet and
 * blitz.
 */
export function gapBlock(
  state: DayState,
  settings: Settings,
  now: number,
): Extract<Decision, { reason: 'gap' }> | null {
  const minutes = settings.gapMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0 || state.lastGameEndedAt === undefined) return null;
  const until = state.lastGameEndedAt + minutes * 60_000;
  return now < until ? { allow: false, reason: 'gap', until } : null;
}

export function evaluate(input: {
  state: DayState;
  settings: Settings;
  gameType: GameType;
  now: number;
}): Decision {
  const { state, settings, gameType, now } = input;

  // Quota comes first because it is not a wait: the day is over, and saying "wait 15
  // minutes" would be a lie since waiting unblocks nothing.
  const quota = quotaBlock(state, settings, gameType);
  if (quota !== null) return quota;

  // Of the two timed blocks, report whichever ends *later* — that is when you can
  // actually play again. Otherwise you would be told 21:30, come back, and be told 21:34.
  const timed: TimedBlock[] = [
    tiltBlock(state, settings, gameType, now),
    gapBlock(state, settings, now),
  ].filter((d) => d !== null);
  if (timed.length > 0) return timed.reduce((a, b) => (b.until > a.until ? b : a));

  return { allow: true };
}

export type GameTypeSummary = {
  gameType: GameType;
  used: number;
  limit: number | null;
  lossStreak: number;
  decision: Decision;
};

/**
 * One row per game type for the popup.
 *
 * The row decision deliberately leaves the gap out: it blocks every type at once, so
 * repeating it on all three rows would say the same thing three times. The popup shows it
 * once, from `gapBlock`.
 */
export function summarize(state: DayState, settings: Settings, now: number): GameTypeSummary[] {
  return GAME_TYPES.map((gameType) => ({
    gameType,
    used: countOf(state, gameType),
    limit: settings.limits[gameType],
    lossStreak: lossStreakOf(state, gameType).losses,
    decision: quotaBlock(state, settings, gameType) ??
      tiltBlock(state, settings, gameType, now) ?? { allow: true },
  }));
}
