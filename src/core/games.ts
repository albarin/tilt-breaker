import { GAME_TYPES, type GameRecord, type GameResult, type GameType, type Ratings } from './types';

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
 *
 * Hands back the mark each game type was left on, which is what you are rated now: the
 * archive is walked in order here, so the last rating it saw is the current one and
 * nothing else has to go looking for it.
 */
function fillRatingDeltas(games: { record: GameRecord; rating: RatingAfter }[]): Ratings {
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

  return Object.fromEntries(previous) as Ratings;
}

/**
 * Your games out of a raw archive, converted once, and what they left you rated.
 *
 * The archive runs to hundreds of games mid-month and every reading below needs the same
 * work done to it, so it is done once and the results are shared.
 *
 * The ratings come out of the same walk as the deltas on purpose. They were fetched from
 * the profile at first, and that made the number beside a game type the one thing on the
 * popup arriving by a different road than the count beside it — so it lagged, by however
 * long it took the next refresh to come round, on exactly the screen you open right after
 * a game. Here they land together or not at all.
 *
 * Only the months fetched are covered, which is why the profile is still read: a game
 * type you have not played this month has no game here to be rated by.
 */
export function toRecords(
  apiGames: ApiGame[],
  username: string,
): { records: GameRecord[]; ratings: Ratings } {
  const rated: { record: GameRecord; rating: RatingAfter }[] = [];
  for (const apiGame of apiGames) {
    const record = toRecord(apiGame, username);
    if (record !== null) rated.push({ record, rating: ratingAfter(apiGame, username) });
  }

  return { records: rated.map(({ record }) => record), ratings: fillRatingDeltas(rated) };
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

/** The end of the newest game counted for the day, or `0` when none is. */
export function newestCounted(games: Record<string, GameRecord>): number {
  let newest = 0;
  for (const game of Object.values(games)) if (game.endedAt > newest) newest = game.endedAt;
  return newest;
}

/**
 * How long a game is given to appear in the archive before we stop expecting it.
 *
 * It normally takes seconds. This is the outer edge of "any moment now", after which a
 * game that has not shown up is more likely never to: an aborted game, or one the site
 * decided not to publish.
 */
export const ARCHIVE_DELAY_MS = 5 * 60_000;

/**
 * How far ahead of the archive our own stamp of the same ending can be.
 *
 * Two clocks mark one game. Ours is the moment the content script sees the game-over modal
 * and the background hears about it, a second or two after the last move. The archive's is
 * `end_time`, the real ending, in whole seconds. So the game we are waiting for arrives
 * *older* than the stamp we are waiting on, and `stamp <= counted` — which is what this
 * used to ask — was never true: the notice stayed on screen for the whole five minutes
 * above, over counts that had been right for most of them.
 *
 * Wide enough to cover the detection lag several times over, and no game is played and
 * finished inside it, so it can never swallow a second ending.
 */
export const REPORT_SKEW_MS = 30_000;

/**
 * Is the count knowably behind — a game has ended, and the archive has not published it?
 *
 * The content script reports the end of a game the moment it happens, and chess.com's
 * archive catches up a few seconds later. In between, every count here is short by exactly
 * the game you just finished, which is the one you opened the popup to see. Knowing that
 * is what lets the popup say so, and the background keep looking.
 *
 * The game must belong to today for this to mean anything: at 00:01, a game from 23:58 is
 * missing from today's count for a reason that has nothing to do with the archive.
 */
export function awaitingArchive(input: {
  lastGameEndedAt: number | undefined;
  counted: number;
  dayStart: number;
  now: number;
}): boolean {
  const { lastGameEndedAt, counted, dayStart, now } = input;
  if (lastGameEndedAt === undefined) return false;
  if (lastGameEndedAt < dayStart) return false;
  // Not `<=`: the archive dates the game a little before we did, so an exact comparison
  // would keep waiting for a game already counted. See REPORT_SKEW_MS.
  if (counted >= lastGameEndedAt - REPORT_SKEW_MS) return false;
  return now - lastGameEndedAt < ARCHIVE_DELAY_MS;
}
