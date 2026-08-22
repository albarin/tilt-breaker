import { classify } from '../core/gametype';
import type { ApiGame } from '../core/games';
import type { GameResult } from '../core/types';

/**
 * Everything this extension knows about the shape of chess.com's archive lives here. The
 * same house rule the DOM file keeps: when the wire format changes, this is the only file
 * to touch.
 *
 * The archive comes as PGN and not as JSON on purpose. Both are the same games at the
 * same URL — `/games/{YYYY}/{MM}` and `/games/{YYYY}/{MM}/pgn` — but on 22 Aug 2026 the
 * JSON one was measured serving a copy that had been pinned in chess.com's CDN for over
 * half an hour (`cf-cache-status: HIT`, `age: 1916`) against its own `max-age=5`. Its
 * `ETag` was pinned with it, so every conditional request answered 304 and the count sat
 * frozen for hours. The PGN twin, asked in the same second, revalidated on every request
 * and carried the game that had just finished.
 *
 * So the format we parse is not a preference: it is the representation that was actually
 * being served fresh. It costs about a megabyte uncompressed against 320 KB of gzipped
 * JSON — chess.com does not compress the PGN — but it is only paid when the month has
 * changed, because `ETag` works here as it was supposed to work there.
 *
 * A game is a block of `[Key "Value"]` headers followed by its moves. We read the headers
 * and drop the moves on the floor: nothing here replays a game.
 */

/** `[EndDate "2026.08.22"]` → `('EndDate', '2026.08.22')`. */
const HEADER = /^\[(\w+)\s+"([\s\S]*)"\]$/;

/**
 * The headers of every game in an archive, in the order the archive lists them.
 *
 * `[Event ...]` opens a game — it is the first header of every one of them — so it is
 * what separates the blocks. Splitting on blank lines would not: there is one between a
 * game's headers and its moves as well.
 */
function blocksOf(text: string): Record<string, string>[] {
  const games: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;

  for (const line of text.split('\n')) {
    const match = HEADER.exec(line.trim());
    if (match === null) continue;
    const [, key, value] = match as unknown as [string, string, string];

    if (key === 'Event') {
      current = {};
      games.push(current);
    }
    // Headers before the first `[Event]` belong to no game and are dropped.
    if (current !== null) current[key] = value;
  }

  return games;
}

/**
 * The game type a PGN time control describes, or `null` for one that is not limited.
 *
 * `"180"` is three minutes with no increment, `"180+2"` adds two seconds a move, and
 * `"1/259200"` is correspondence — three days a move, which does not consume a sitting.
 * `"-"` appears on untimed games, which are not one either.
 *
 * Classified from the seconds rather than taken from a label, by the same rule the lobby
 * is read with: `classify` is the one place that decides where bullet ends and blitz
 * starts, and it decides it for both.
 */
export function gameTypeFromTimeControl(raw: string | undefined): string {
  if (raw === undefined) return 'unknown';
  // Correspondence: moves per day, not seconds on a clock.
  if (raw.includes('/')) return 'daily';

  const [base, increment = '0'] = raw.split('+');
  const seconds = Number(base);
  const added = Number(increment);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(added)) return 'unknown';

  return classify({ base: seconds, increment: added });
}

/**
 * When a game ended, in epoch milliseconds.
 *
 * `[EndDate]` and `[EndTime]` are stamped in the zone `[Timezone]` names, and the archive
 * says `UTC` for every game it has ever served. Read as UTC regardless, because the
 * alternative to a game placed a few hours out is a game dropped entirely — and a dropped
 * game is one the quota never sees, which is the failure that lets you keep playing.
 */
function endedAt(headers: Record<string, string>): number | null {
  const date = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(headers['EndDate'] ?? '');
  const time = /^(\d{2}):(\d{2}):(\d{2})$/.exec(headers['EndTime'] ?? '');
  if (date === null || time === null) return null;

  const [, year, month, day] = date.map(Number) as [number, number, number, number];
  const [, hour, minute, second] = time.map(Number) as [number, number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Who won, from `[Result]` alone.
 *
 * Deliberately not from `[Termination]`, which says *how* it ended in an English
 * sentence — "crabinloan won by checkmate". The score is the same three symbols in every
 * language and has been for two centuries, and how a game ended is not something anything
 * here needs to know.
 *
 * `'*'` is a game still in progress. It has no result to report and none to count, so the
 * caller drops it.
 */
function scoreOf(result: string | undefined): { white: GameResult; black: GameResult } | null {
  if (result === '1-0') return { white: 'win', black: 'loss' };
  if (result === '0-1') return { white: 'loss', black: 'win' };
  if (result === '1/2-1/2') return { white: 'draw', black: 'draw' };
  return null;
}

/** `[WhiteElo "812"]` → `812`, and nothing at all where the archive gave no number. */
function ratingOf(raw: string | undefined): { rating: number } | Record<string, never> {
  const rating = Number(raw);
  return Number.isFinite(rating) && rating > 0 ? { rating } : {};
}

/** One PGN block as an archive game, or `null` if it is not one we can count. */
function toGame(headers: Record<string, string>): ApiGame | null {
  const url = headers['Link'];
  const ended = endedAt(headers);
  const score = scoreOf(headers['Result']);
  const white = headers['White'];
  const black = headers['Black'];
  if (url === undefined || ended === null || score === null) return null;
  if (white === undefined || black === undefined) return null;

  return {
    url,
    time_class: gameTypeFromTimeControl(headers['TimeControl']),
    // The archive's own unit is seconds and everything downstream expects that, so the
    // milliseconds we just built go back to seconds here rather than a second shape of
    // "when it ended" existing alongside the first.
    end_time: Math.floor(ended / 1000),
    white: { username: white, result: score.white, ...ratingOf(headers['WhiteElo']) },
    black: { username: black, result: score.black, ...ratingOf(headers['BlackElo']) },
  };
}

/**
 * Every game in a monthly archive.
 *
 * Games that cannot be read are skipped rather than thrown over: one malformed block in a
 * month of four hundred must not cost you the other three hundred and ninety-nine, which
 * is what an exception here would do — `fetchMonth` turns a throw into "the API is down"
 * and the day falls back to the last snapshot.
 */
export function parseArchive(text: string): ApiGame[] {
  const games: ApiGame[] = [];
  for (const headers of blocksOf(text)) {
    const game = toGame(headers);
    if (game !== null) games.push(game);
  }
  return games;
}
