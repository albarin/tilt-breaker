/** Live game types we can limit. Correspondence (`daily`) is deliberately excluded. */
export type GameType = 'bullet' | 'blitz' | 'rapid';

export const GAME_TYPES: readonly GameType[] = ['bullet', 'blitz', 'rapid'] as const;

export type GameResult = 'win' | 'loss' | 'draw';

/**
 * What you are rated in each game type.
 *
 * Partial because a game type you have never played has no rating, and a missing entry is
 * the only honest way to say so: `0` is a rating, and it is not yours.
 */
export type Ratings = Partial<Record<GameType, number>>;

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
  /**
   * What this game did to your rating, once it is known.
   *
   * Stored rather than derived, unlike every other count here, because it cannot be
   * derived from a day: the archive reports the rating *after* each game and never the
   * change, so the first game of the day can only be measured against one played
   * yesterday. `undefined` means the archive did not reach back far enough to say — not
   * that nothing moved, which is `0`.
   */
  ratingDelta?: number;
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
  /**
   * Hide chess.com's resign button.
   *
   * Every other rule here guards the way *into* a game; this one guards the way out. A
   * game going badly is one click from being over, and the game that follows it is the
   * one you never decided to play — resigning is how a bad position turns into another
   * bad position five minutes later.
   *
   * Hidden and not greyed out, the only control treated that way. The blocks grey things
   * because a refusal has to look deliberate; this refuses nothing you would otherwise be
   * owed, so there is no refusal to explain, only a button that is not there.
   *
   * Off by default: some games are worth resigning, and that judgement is yours.
   */
  hideResign: boolean;
};

export type DayState = {
  /** Local day key, already shifted by `DAY_RESET_HOUR`. */
  dayKey: string;
  games: Record<string, GameRecord>;
  /**
   * Games chess.com has counted that the archive has not handed over yet, per game type.
   *
   * They have no id, no result and no clock: `/stats` reports totals, not games. So they
   * are held apart from `games` rather than faked into it — countable, and nothing else.
   * A game here is one that is known to exist and not yet known to be anything.
   *
   * They count against the quota all the same. Of the two ways to be wrong about a game
   * chess.com has confirmed and the archive is late with, only one of them lets you keep
   * playing.
   */
  pending?: Partial<Record<GameType, number>>;
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
  hideResign: false,
};
