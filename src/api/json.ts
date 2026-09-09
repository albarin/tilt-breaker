import type { ApiGame } from '../core/games';
import type { GameResult } from '../core/types';
import { gameTypeFromTimeControl } from './pgn';

/**
 * The JSON representation of the monthly archive, kept as the fallback for the PGN one.
 *
 * Both live at one path and hold the same games; `pgn.ts` says why PGN is read first. This
 * exists because on 9 Sep 2026 the PGN endpoint answered 404 for the current month of
 * every account — a Twirp "internal error" served with a 404 status and cached by the CDN
 * — while the JSON twin kept answering. A month that could not be read is a day the quota
 * cannot see, so the second road stays open even though the first one is preferred.
 *
 * The same games, field for field, so the parser does what the PGN one does and nothing
 * more: the game type comes off `time_control` through the one function that decides
 * where bullet ends, not off the `time_class` label, so a game reads the same whichever
 * representation it came in by.
 */

type Side = { username?: string; result?: string; rating?: number };

type JsonGame = {
  url?: string;
  time_control?: string;
  end_time?: number;
  white?: Side;
  black?: Side;
};

/**
 * Result codes that mean a draw. The JSON says *how* a game ended per side, in a code:
 * `'win'` is a win, these are draws, and anything else — `checkmated`, `resigned`,
 * `timeout`, `abandoned` and so on — is a loss.
 */
const DRAW_CODES = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

function resultFrom(code: string | undefined): GameResult | null {
  if (code === undefined) return null;
  if (code === 'win') return 'win';
  return DRAW_CODES.has(code) ? 'draw' : 'loss';
}

function sideOf(
  side: Side | undefined,
): { username: string; result: GameResult; rating?: number } | null {
  const result = resultFrom(side?.result);
  if (side?.username === undefined || result === null) return null;
  const rating = side.rating;
  return {
    username: side.username,
    result,
    ...(typeof rating === 'number' && rating > 0 ? { rating } : {}),
  };
}

/** One JSON game as an archive game, or `null` if it is not one we can count. */
function toGame(game: JsonGame): ApiGame | null {
  const white = sideOf(game.white);
  const black = sideOf(game.black);
  if (game.url === undefined || typeof game.end_time !== 'number') return null;
  if (white === null || black === null) return null;

  return {
    url: game.url,
    time_class: gameTypeFromTimeControl(game.time_control),
    end_time: game.end_time,
    white,
    black,
  };
}

/**
 * Every game in a monthly archive, from its JSON body.
 *
 * Like `parseArchive`, a game that cannot be read is skipped rather than thrown over, and
 * a body with no `games` list at all is an empty month: that is what the server sends for
 * one you did not play.
 */
export function parseJsonArchive(body: unknown): ApiGame[] {
  const list = (body as { games?: unknown } | null)?.games;
  if (!Array.isArray(list)) return [];

  const games: ApiGame[] = [];
  for (const entry of list as JsonGame[]) {
    const game = toGame(entry);
    if (game !== null) games.push(game);
  }
  return games;
}
