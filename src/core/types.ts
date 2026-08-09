/** Live game types we can limit. Correspondence (`daily`) is deliberately excluded. */
export type GameType = 'bullet' | 'blitz' | 'rapid';

export const GAME_TYPES: readonly GameType[] = ['bullet', 'blitz', 'rapid'] as const;

export type GameResult = 'win' | 'loss' | 'draw';

/**
 * One counted game, as chess.com reports it. Keyed by game id, so re-reading the archive
 * is idempotent: a game can never be counted twice.
 */
export type GameRecord = {
  id: string;
  gameType: GameType;
  /** Epoch ms. Approximated as `endedAt`: the archive carries no start time. */
  startedAt: number;
  endedAt: number;
  result: GameResult;
};

/** The daily quota resets at local midnight. Fixed on purpose, not configurable. */
export const DAY_RESET_HOUR = 0;

/** Minutes of enforced rest after a losing streak. Fixed on purpose. */
export const COOLDOWN_MINUTES = 60;

export type Settings = {
  /** `null` means no limit. */
  limits: Record<GameType, number | null>;
  /** Consecutive losses in one game type that trigger the cooldown. */
  tilt: { losses: number };
  /**
   * Always block the rematch button, quota or no quota.
   *
   * Not a counting rule but an impulse one: the rematch button is what turns one game
   * into five without you ever deciding to. Walking back to the lobby takes a few
   * seconds, and those seconds are the decision you were skipping.
   */
  blockRematch: boolean;
};

export type DayState = {
  /** Local day key, already shifted by `DAY_RESET_HOUR`. */
  dayKey: string;
  games: Record<string, GameRecord>;
};

export const DEFAULT_SETTINGS: Settings = {
  limits: { bullet: 3, blitz: 5, rapid: null },
  tilt: { losses: 3 },
  blockRematch: true,
};
