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

  const endedAt = game.end_time * 1000;
  return {
    id,
    gameType: game.time_class,
    // The archive has no start time for live games. Streaks are ordered by end time
    // anyway, so the approximation feeds into no decision.
    startedAt: endedAt,
    endedAt,
    result: resultFrom(side.result),
  };
}

/** Your games for the day, keyed by id so re-reading the archive never double-counts. */
export function gamesForDay(input: {
  apiGames: ApiGame[];
  username: string;
  dayStart: number;
  dayEnd: number;
}): Record<string, GameRecord> {
  const { apiGames, username, dayStart, dayEnd } = input;
  const games: Record<string, GameRecord> = {};

  for (const apiGame of apiGames) {
    const endedAt = apiGame.end_time * 1000;
    if (endedAt < dayStart || endedAt >= dayEnd) continue;
    const record = toRecord(apiGame, username);
    if (record !== null) games[record.id] = record;
  }
  return games;
}

/**
 * When your most recent game in the archive ended, ignoring the day window.
 *
 * The gap between games has to hold across midnight, so this deliberately does not filter
 * by day the way `gamesForDay` does.
 */
export function lastGameEnd(apiGames: ApiGame[], username: string): number | null {
  let last: number | null = null;
  for (const apiGame of apiGames) {
    if (toRecord(apiGame, username) === null) continue;
    const endedAt = apiGame.end_time * 1000;
    if (last === null || endedAt > last) last = endedAt;
  }
  return last;
}
