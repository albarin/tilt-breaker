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
  /** Epoch ms. The archive carries no start time for live games, and nothing needs one. */
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
   * Minutes that must pass between games. `0` switches it off.
   *
   * Global rather than per game type on purpose: alternating bullet and blitz would walk
   * straight around a per-type gap.
   */
  gapMinutes: number;
  /**
   * Always block the rematch and next-game buttons, quota or no quota.
   *
   * Not a counting rule but an impulse one: those buttons are what turn one game into
   * five without you ever deciding to. Walking back to the lobby takes a few seconds, and
   * those seconds are the decision you were skipping.
   *
   * Off, they still obey a block that covers every game type: the setting decides whether
   * chaining a game is an impulse worth stopping, not whether the quota applies.
   */
  blockRematch: boolean;
};

export type DayState = {
  /** Local day key, already shifted by `DAY_RESET_HOUR`. */
  dayKey: string;
  games: Record<string, GameRecord>;
  /**
   * End of your most recent game of any type, even if it was yesterday.
   *
   * Kept apart from `games` because the gap has to survive the day rollover: finishing at
   * 23:58 must still hold you back at 00:05, when today's games are empty.
   */
  lastGameEndedAt?: number;
};

export const DEFAULT_SETTINGS: Settings = {
  limits: { bullet: 8, blitz: 6, rapid: 3 },
  tilt: { losses: 3 },
  gapMinutes: 15,
  blockRematch: true,
};
