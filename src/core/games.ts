import { GAME_TYPES, type GameRecord, type GameResult, type GameType } from './types';

/** The subset of a chess.com monthly-archive game that we care about. */
export type ApiGame = {
  url: string;
  time_class: string;
  /** Epoch in **seconds**, not milliseconds. */
  end_time: number;
  white: { username: string; result: string };
  black: { username: string; result: string };
};

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

/** Turns an archive game into one of ours, or `null` if it does not count. */
export function toRecord(game: ApiGame, username: string): GameRecord | null {
  const id = parseGameId(game.url);
  if (id === null) return null;

  // `daily` is correspondence: it does not consume a sitting, so it is not limited.
  if (!isGameType(game.time_class)) return null;

  const me = username.toLowerCase();
  const side =
    game.white.username.toLowerCase() === me
      ? game.white
      : game.black.username.toLowerCase() === me
        ? game.black
        : null;
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
 * Your games out of a raw archive, converted once.
 *
 * The archive runs to hundreds of games mid-month and both readings below need the same
 * work done to it, so it is done once and the results are shared.
 */
export function toRecords(apiGames: ApiGame[], username: string): GameRecord[] {
  const records: GameRecord[] = [];
  for (const apiGame of apiGames) {
    const record = toRecord(apiGame, username);
    if (record !== null) records.push(record);
  }
  return records;
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
