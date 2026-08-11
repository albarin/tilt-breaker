import { GAME_TYPES, type GameRecord, type GameResult, type GameType } from './types';

/** The subset of a chess.com monthly-archive game that we care about. */
export type ApiGame = {
  url: string;
  time_class: string;
  /** Epoch in **seconds**, not milliseconds. */
  end_time: number;
  /** Absent is read as rated: that is the overwhelming case, and `rating` decides anyway. */
  rated?: boolean;
  white: Side;
  black: Side;
};

/** `rating` is optional because it is the archive's word, not ours, and a rating we did
 * not get is a rating we must not invent: it leaves the game's delta unknown. */
type Side = { username: string; result: string; rating?: number };

/**
 * Result codes that mean a draw. Anything that is neither `'win'` nor listed here is a
 * loss: `checkmated`, `resigned`, `timeout`, `abandoned`, and so on.
 */
const DRAW_CODES = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

function resultFrom(code: string): GameResult {
  if (code === 'win') return 'win';
  return DRAW_CODES.has(code) ? 'draw' : 'loss';
}

/** `https://www.chess.com/game/live/123456789` → `'123456789'`. */
export function parseGameId(url: string): string | null {
  return /\/game\/(?:live\/)?(\d+)/.exec(url)?.[1] ?? null;
}

function isGameType(value: string): value is GameType {
  return (GAME_TYPES as readonly string[]).includes(value);
}

/** Your half of a game, or `null` if it is not one of yours. */
function sideOf(game: ApiGame, username: string): Side | null {
  const me = username.toLowerCase();
  if (game.white.username.toLowerCase() === me) return game.white;
  if (game.black.username.toLowerCase() === me) return game.black;
  return null;
}

/** Turns an archive game into one of ours, or `null` if it does not count. */
export function toRecord(game: ApiGame, username: string): GameRecord | null {
  const id = parseGameId(game.url);
  if (id === null) return null;

  // `daily` is correspondence: it does not consume a sitting, so it is not limited.
  if (!isGameType(game.time_class)) return null;

  const side = sideOf(game, username);
  if (side === null) return null; // not one of your games

  return {
    id,
    gameType: game.time_class,
    // The only place the archive's seconds become milliseconds. Everything downstream
    // reads `endedAt` and never touches `end_time` again.
    endedAt: game.end_time * 1000,
    result: resultFrom(side.result),
  };
}

/**
 * What the archive says your rating was after a game: the number it left you on,
 * `'unrated'` when the game could not have moved it, or `null` when it did not say.
 *
 * The three are kept apart because only the middle one is a known zero. An unrated game
 * reports a rating all the same — the one it left untouched — and taking it would be
 * harmless here but wrong as a mark for the next game to be measured against.
 */
type RatingAfter = number | 'unrated' | null;

function ratingAfter(game: ApiGame, username: string): RatingAfter {
  if (game.rated === false) return 'unrated';
  return sideOf(game, username)?.rating ?? null;
}

/**
 * Fills in what each game did to your rating.
 *
 * The archive gives the rating after a game and never the change, so a game can only be
 * measured against the one before it in the same game type — which is why this runs over
 * the whole archive and not over a day: the game that set today's opening rating was
 * played yesterday.
 *
 * Two games keep no delta rather than a wrong one. The earliest rated game of the archive
 * has nothing before it to subtract, and a game the archive gave no rating for cannot be
 * placed at all; both stay `undefined`, which is the caller's cue to say nothing rather
 * than to add a zero that would read as "you held your rating".
 *
 * An unrated game is the case that is genuinely known: it moved nothing, so it takes a
 * real `0` and leaves the running mark where it was.
 */
function fillRatingDeltas(games: { record: GameRecord; rating: RatingAfter }[]): void {
  const previous = new Map<GameType, number>();

  for (const { record, rating } of [...games].sort((a, b) => a.record.endedAt - b.record.endedAt)) {
    if (rating === 'unrated') {
      record.ratingDelta = 0;
      continue;
    }
    // No rating to place it by. It keeps no delta, and neither can whatever comes next:
    // measuring that against the last rating we did see would hand it this game's change
    // as well as its own.
    if (rating === null) {
      previous.delete(record.gameType);
      continue;
    }
    const before = previous.get(record.gameType);
    if (before !== undefined) record.ratingDelta = rating - before;
    previous.set(record.gameType, rating);
  }
}

/**
 * Your games out of a raw archive, converted once.
 *
 * The archive runs to hundreds of games mid-month and both readings below need the same
 * work done to it, so it is done once and the results are shared.
 */
export function toRecords(apiGames: ApiGame[], username: string): GameRecord[] {
  const rated: { record: GameRecord; rating: RatingAfter }[] = [];
  for (const apiGame of apiGames) {
    const record = toRecord(apiGame, username);
    if (record !== null) rated.push({ record, rating: ratingAfter(apiGame, username) });
  }

  fillRatingDeltas(rated);
  return rated.map(({ record }) => record);
}

/** Your games for the day, keyed by id so re-reading the archive never double-counts. */
export function gamesForDay(input: {
  records: GameRecord[];
  dayStart: number;
  dayEnd: number;
}): Record<string, GameRecord> {
  const { records, dayStart, dayEnd } = input;
  const games: Record<string, GameRecord> = {};

  for (const record of records) {
    if (record.endedAt < dayStart || record.endedAt >= dayEnd) continue;
    games[record.id] = record;
  }
  return games;
}

/**
 * When your most recent game in the archive ended, ignoring the day window.
 *
 * The gap between games has to hold across midnight, so this deliberately does not filter
 * by day the way `gamesForDay` does.
 */
export function lastGameEnd(records: GameRecord[]): number | null {
  let last: number | null = null;
  for (const record of records) {
    if (last === null || record.endedAt > last) last = record.endedAt;
  }
  return last;
}
