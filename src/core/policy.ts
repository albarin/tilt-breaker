import {
  COOLDOWN_MINUTES,
  GAME_TYPES,
  type DayState,
  type Settings,
  type GameType,
} from './types';

export type Decision =
  | { allow: true }
  | { allow: false; reason: 'quota'; used: number; limit: number }
  | { allow: false; reason: 'tilt'; losses: number; until: number };

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

export function evaluate(input: {
  state: DayState;
  settings: Settings;
  gameType: GameType;
  now: number;
}): Decision {
  const { state, settings, gameType, now } = input;

  // Quota is checked before the streak on purpose. If the day is already spent, saying
  // "wait 60 minutes" would be a lie: waiting unblocks nothing.
  const limit = settings.limits[gameType];
  const used = countOf(state, gameType);
  if (limit !== null && used >= limit) {
    return { allow: false, reason: 'quota', used, limit };
  }

  // The cooldown counts from the last loss, so every further loss re-arms it: come back
  // the moment it expires, lose again, and it starts over.
  const { losses, lastLossAt } = lossStreakOf(state, gameType);
  if (lastLossAt !== null && losses >= settings.tilt.losses) {
    const until = lastLossAt + COOLDOWN_MINUTES * 60_000;
    if (now < until) return { allow: false, reason: 'tilt', losses, until };
  }

  return { allow: true };
}

export type GameTypeSummary = {
  gameType: GameType;
  used: number;
  limit: number | null;
  lossStreak: number;
  decision: Decision;
};

/** Everything the popup needs to render, in one pass. */
export function summarize(state: DayState, settings: Settings, now: number): GameTypeSummary[] {
  return GAME_TYPES.map((gameType) => ({
    gameType,
    used: countOf(state, gameType),
    limit: settings.limits[gameType],
    lossStreak: lossStreakOf(state, gameType).losses,
    decision: evaluate({ state, settings, gameType, now }),
  }));
}
