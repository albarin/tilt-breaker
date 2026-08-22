import type { ApiGame } from '../core/games';

/**
 * Writes archive games back out as PGN, for tests.
 *
 * Only ever imported by tests — nothing the extension ships reaches for it, so it falls
 * out of the build. It lives beside the parser rather than inside one test file because
 * three of them need it, and three hand-rolled copies of chess.com's header order would
 * drift apart at the first change.
 *
 * The headers are the ones the real archive sends, in the order it sends them, moves and
 * openings included: a parser tested against a tidied-up sample is a parser tested against
 * something that never arrives.
 */
export function toPgn(game: ApiGame, extra: Record<string, string> = {}): string {
  const ended = new Date(game.end_time * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const date = `${ended.getUTCFullYear()}.${pad(ended.getUTCMonth() + 1)}.${pad(ended.getUTCDate())}`;
  const time = `${pad(ended.getUTCHours())}:${pad(ended.getUTCMinutes())}:${pad(ended.getUTCSeconds())}`;

  const score =
    game.white.result === 'draw' ? '1/2-1/2' : game.white.result === 'win' ? '1-0' : '0-1';

  const control = { bullet: '60', blitz: '180', rapid: '900', daily: '1/259200' };

  const headers: Record<string, string> = {
    Event: 'Live Chess',
    Site: 'Chess.com',
    Date: date,
    Round: '-',
    White: game.white.username,
    Black: game.black.username,
    Result: score,
    Timezone: 'UTC',
    ECO: 'C20',
    UTCDate: date,
    UTCTime: time,
    ...(game.white.rating === undefined ? {} : { WhiteElo: String(game.white.rating) }),
    ...(game.black.rating === undefined ? {} : { BlackElo: String(game.black.rating) }),
    TimeControl: control[game.time_class as keyof typeof control] ?? game.time_class,
    Termination: `${game.white.username} won`,
    EndDate: date,
    EndTime: time,
    Link: game.url,
    ...extra,
  };

  const lines = Object.entries(headers).map(([key, value]) => `[${key} "${value}"]`);
  return `${lines.join('\n')}\n\n1. e4 e5 2. Nf3 ${score}\n`;
}

/** A whole monthly archive: games separated the way the server separates them. */
export function toArchive(...games: ApiGame[]): string {
  return games.map((game) => toPgn(game)).join('\n');
}
