import { COOLDOWN_MINUTES, GAME_TYPES, type DayState, type Settings, type GameType } from './types';

export type Decision =
  | { allow: true }
  | { allow: false; reason: 'quota'; used: number; limit: number }
  | { allow: false; reason: 'tilt'; losses: number; until: number }
  | { allow: false; reason: 'gap'; until: number };

/** A block with a time attached, which is every one of them except the quota. */
export type TimedBlock = Extract<Decision, { until: number }>;

/**
 * Is that limit switched off rather than spent?
 *
 * Zero and "all used up" are different states wearing the same numbers, and every surface
 * that renders a quota has to tell them apart — "0 of 0 played" reads as a bug. Stated
 * here so a new surface inherits the distinction instead of rediscovering it.
 */
export function isOff(limit: number | null): boolean {
  return limit === 0;
}

/** Games of one game type, oldest first. */
function gamesOf(state: DayState, gameType: GameType) {
  return Object.values(state.games)
    .filter((g) => g.gameType === gameType)
    .sort((a, b) => a.endedAt - b.endedAt);
}

/** Games chess.com has counted for one game type that the archive has not published. */
export function pendingOf(state: DayState, gameType: GameType): number {
  return state.pending?.[gameType] ?? 0;
}

/**
 * How many games of one type today.
 *
 * The games we have, plus the ones chess.com's own record says exist and the archive has
 * not handed over. Both are games you played; only one of them has anything else known
 * about it. Counting the archive alone is what let a stale copy of it read as an
 * afternoon off — see `pending` on {@link DayState}.
 *
 * Otherwise derived from the games rather than stored, so it cannot drift on its own.
 */
export function countOf(state: DayState, gameType: GameType): number {
  return gamesOf(state, gameType).length + pendingOf(state, gameType);
}

/** How the day went for one game type. Named `Tally` to stay clear of TS's `Record`. */
export type Tally = { wins: number; losses: number; draws: number };

/**
 * Wins, losses and draws for one game type today.
 *
 * The three add up to `countOf` **minus** whatever is pending: a game the archive has not
 * published has no result to file under any of them. Every surface that shows a tally
 * beside a count has to show the pending games too, or the row will not add up on screen.
 */
export function tallyOf(state: DayState, gameType: GameType): Tally {
  const tally: Tally = { wins: 0, losses: 0, draws: 0 };
  for (const game of gamesOf(state, gameType)) {
    if (game.result === 'win') tally.wins++;
    else if (game.result === 'loss') tally.losses++;
    else tally.draws++;
  }
  return tally;
}

/**
 * What the day has done to your rating in one game type, or `null` when it cannot be said.
 *
 * Added up from the games rather than read off the first and last, so it does not care
 * what order the archive hands them over in.
 *
 * One game whose change is unknown makes the whole day unknown. A total quietly missing a
 * game is worse than no total: it still looks like an answer, and on the day this matters
 * most — the one you came to the popup to check — it would be the game you just lost.
 *
 * A pending game is exactly that game. It is known to have been played and nothing else,
 * so while one is outstanding the day's rating cannot be told.
 */
export function ratingDeltaOf(state: DayState, gameType: GameType): number | null {
  if (pendingOf(state, gameType) > 0) return null;
  let total = 0;
  for (const game of gamesOf(state, gameType)) {
    if (game.ratingDelta === undefined) return null;
    total += game.ratingDelta;
  }
  return total;
}

/**
 * Consecutive losses at the end of the day, and when the last one happened.
 *
 * Pending games are not in it and cannot be: a streak is made of results, and a pending
 * game has none. So a cooldown can arrive a few seconds late, when the archive publishes
 * the loss that completed the streak. That is the one place this design accepts being
 * behind, because the alternative is guessing that an unknown game was a loss — and the
 * quota, which does count it, is what holds the line meanwhile.
 */
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

/**
 * Which block applies to one game type, and which of them wins.
 *
 * The single authority on that ordering: the overlay enforces what this returns and the
 * popup's rows describe it, so a precedence that lived in two places would let the popup
 * call a game type playable while the click is refused.
 */
export function evaluate(input: {
  state: DayState;
  settings: Settings;
  gameType: GameType;
  now: number;
  /** Off for per-type rows: the gap blocks every type at once and is reported once. */
  includeGap?: boolean;
}): Decision {
  const { state, settings, gameType, now, includeGap = true } = input;

  // Quota comes first because it is not a wait: the day is over, and saying "wait 15
  // minutes" would be a lie since waiting unblocks nothing.
  const quota = quotaBlock(state, settings, gameType);
  if (quota !== null) return quota;

  // Of the two timed blocks, report whichever ends *later* — that is when you can
  // actually play again. Otherwise you would be told 21:30, come back, and be told 21:34.
  const timed: TimedBlock[] = [
    tiltBlock(state, settings, gameType, now),
    includeGap ? gapBlock(state, settings, now) : null,
  ].filter((d) => d !== null);
  if (timed.length > 0) return timed.reduce((a, b) => (b.until > a.until ? b : a));

  return { allow: true };
}

export type GameTypeSummary = {
  gameType: GameType;
  used: number;
  limit: number | null;
  /** Wins, losses and draws behind `used`. With `pending`, the four add up to it. */
  tally: Tally;
  /**
   * Games counted from chess.com's record that the archive has not published yet.
   *
   * Rendered rather than hidden: they are the difference between a row that adds up and
   * one that looks broken, and "one still on its way" is the honest thing to say while the
   * site catches up.
   */
  pending: number;
  /** Rating gained or lost today, or `null` when one of the games cannot be measured. */
  ratingDelta: number | null;
  lossStreak: number;
  decision: Decision;
};

/**
 * One row per game type for the popup.
 *
 * The row decision deliberately leaves the gap out: it blocks every type at once, so
 * repeating it on all three rows would say the same thing three times. The popup shows it
 * once, from `gapBlock`. Everything else about which block wins comes from `evaluate`, so
 * the rows cannot drift from what the click interceptor enforces.
 */
export function summarize(state: DayState, settings: Settings, now: number): GameTypeSummary[] {
  return GAME_TYPES.map((gameType) => ({
    gameType,
    used: countOf(state, gameType),
    limit: settings.limits[gameType],
    tally: tallyOf(state, gameType),
    pending: pendingOf(state, gameType),
    ratingDelta: ratingDeltaOf(state, gameType),
    lossStreak: lossStreakOf(state, gameType).losses,
    decision: evaluate({ state, settings, gameType, now, includeGap: false }),
  }));
}
