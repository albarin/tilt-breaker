import type { ApiGame } from '../core/games';
import { parseJsonArchive } from './json';
import { parseArchive } from './pgn';
import { GAME_TYPES, type GameType, type Ratings } from '../core/types';

/**
 * Client for chess.com's public monthly archive.
 *
 * `https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}/pgn`
 *
 * No key, no session: it is public data. This is where the extension's counts come from,
 * so it knows the real game type and result instead of guessing from the page.
 *
 * **The PGN representation, not the JSON one.** Both exist at that path and hold the same
 * games; `api/pgn.ts` says at length why the choice is not cosmetic. In short: on 22 Aug
 * 2026 the JSON copy was measured pinned in chess.com's CDN for over half an hour against
 * its own `max-age=5`, ETag and all, and the PGN copy of the same games revalidated on
 * every request.
 *
 * The archive is large — around a megabyte mid-month, and chess.com does not compress it —
 * and this is polled every few seconds while a finished game is on its way, so requests
 * are conditional and the server answers 304 with no body when you have not played since
 * last time.
 *
 * Conditional on the **ETag**, not on `Last-Modified`. The server sends both, but measured
 * against it, `If-Modified-Since` is ignored: echoing its own stamp back — in its own
 * format, in RFC 1123, or a second earlier — answers 200 with the whole archive every
 * time. `If-None-Match` answers 304.
 *
 * `ETag` is not a CORS-safelisted response header, unlike `Last-Modified`. It is readable
 * here because the background holds `api.chess.com` in `host_permissions`, which exempts
 * its requests from CORS filtering. Read from a content script it would come back null.
 */

export type Month = { year: number; month: number };
export type Fetcher = typeof fetch;

/** Cache key for a month: `'2026-08'`. */
export function monthKey({ year, month }: Month): string {
  return `${year}-${month.toString().padStart(2, '0')}`;
}

/**
 * The months needed to cover a time window.
 *
 * Archives are keyed by **UTC** month while our day is local, so a day can span two of
 * them and need two archives.
 */
export function monthsCovering(startMs: number, endMs: number): Month[] {
  const months: Month[] = [];
  const seen = new Set<string>();
  for (const ms of [startMs, endMs]) {
    const d = new Date(ms);
    const month = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    if (seen.has(monthKey(month))) continue;
    seen.add(monthKey(month));
    months.push(month);
  }
  return months;
}

/**
 * The profile endpoint for an account, and the base every other one hangs off.
 *
 * How a username becomes a URL is stated here and nowhere else: lowercased because the
 * API keys players that way, escaped because names may carry anything.
 */
function playerUrl(username: string): string {
  return `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`;
}

/** The month's JSON representation. The PGN one is this with `/pgn` on the end. */
export function jsonArchiveUrl(username: string, month: Month): string {
  return `${playerUrl(username)}/games/${monthKey(month).replace('-', '/')}`;
}

export function archiveUrl(username: string, month: Month): string {
  return `${jsonArchiveUrl(username, month)}/pgn`;
}

/** `ETag`s per month, so we only ask for what changed. */
export type Etags = Record<string, string>;

export type ArchiveResult = {
  games: ApiGame[];
  /** `true` when **every** month answered 304: the caller can keep its cache. */
  unchanged: boolean;
  etags: Etags;
};

/** One request for one representation of a month, conditional on the stamp we hold. */
function ask(url: string, previous: string | undefined, fetchImpl: Fetcher): Promise<Response> {
  return fetchImpl(url, {
    headers: previous === undefined ? {} : { 'If-None-Match': previous },
    /*
     * Never the browser's copy. The archive is served `max-age=5`, so a request made
     * within five seconds of the last one was answered from the HTTP cache without
     * leaving the machine — and the request that lands in that window is the one that
     * matters: the sync fired when a game ends, then the popup opened right after it.
     * The game you just played would be missing from both, for no reason a user could
     * see. Freshness here is `If-None-Match`, which costs a 304 and is ours to control.
     */
    cache: 'no-store',
  });
}

type MonthResult = { games: ApiGame[] | null; etag?: string };

function withStamp(games: ApiGame[], response: Response): MonthResult {
  const etag = response.headers.get('etag') ?? undefined;
  return { games, ...(etag === undefined ? {} : { etag }) };
}

/**
 * Downloads one monthly archive.
 *
 * A month you did not play is a 200 with nothing in it, in either representation. A 404
 * is **not** that, though this used to read it so: on 9 Sep 2026 the PGN endpoint answered
 * 404 for the current month of every account on the site, a Twirp "internal error" wearing
 * a not-found status and cached by the CDN. Read as "no games this month" it emptied the
 * day, and the month's every game came back as unpublished — which held the quota, but
 * with numbers that were not true.
 *
 * So anything the PGN endpoint will not answer is asked of the JSON one, which was fine
 * that day. It is the second road and not the first because `pgn.ts` measured it pinned in
 * the CDN on 22 Aug; a copy that may be stale is still the better of the two answers when
 * the other is no answer at all. Only when both fail does this throw: we never invent an
 * empty list, because an empty list would look like "no games today" and would lift the
 * block.
 *
 * One stamp per month, whichever representation it came from. Sent to the other one it
 * simply does not match, and that costs a full read, not a wrong one.
 */
async function fetchMonth(
  username: string,
  month: Month,
  previous: string | undefined,
  fetchImpl: Fetcher,
): Promise<MonthResult> {
  const pgn = await ask(archiveUrl(username, month), previous, fetchImpl);
  if (pgn.status === 304) return { games: null, etag: previous };
  if (pgn.ok) return withStamp(parseArchive(await pgn.text()), pgn);

  const json = await ask(jsonArchiveUrl(username, month), previous, fetchImpl);
  if (json.status === 304) return { games: null, etag: previous };
  if (!json.ok) {
    throw new Error(`chess.com API responded ${pgn.status} (PGN) and ${json.status} (JSON)`);
  }
  return withStamp(parseJsonArchive(await json.json()), json);
}

/** Every game from the months covering the given window. */
export async function fetchGamesCovering(input: {
  username: string;
  startMs: number;
  endMs: number;
  etags?: Etags;
  fetchImpl?: Fetcher;
}): Promise<ArchiveResult> {
  const { username, startMs, endMs, etags = {}, fetchImpl = fetch } = input;
  const months = monthsCovering(startMs, endMs);

  const results = await Promise.all(
    months.map((month) => fetchMonth(username, month, etags[monthKey(month)], fetchImpl)),
  );

  // A mixed answer — one month 304, another changed — cannot keep any cache: the caller
  // rebuilds the day from `games` alone and no per-month copy exists, so the 304'd
  // month's games would silently vanish from the count. Fetch those months in full.
  if (results.some((r) => r.games === null) && results.some((r) => r.games !== null)) {
    await Promise.all(
      results.map(async (result, i) => {
        if (result.games !== null) return;
        results[i] = await fetchMonth(username, months[i]!, undefined, fetchImpl);
      }),
    );
  }

  const stamps: Etags = {};
  const games: ApiGame[] = [];
  let unchanged = true;

  results.forEach((result, i) => {
    const key = monthKey(months[i]!);
    if (result.etag !== undefined) stamps[key] = result.etag;
    if (result.games === null) return; // 304: nothing new this month
    unchanged = false;
    games.push(...result.games);
  });

  return { games, unchanged, etags: stamps };
}

/**
 * The account's avatar URL, or `null` if it has none or the profile cannot be read.
 *
 * Never throws: an avatar is decoration, and failing to fetch one must not disturb the
 * counting that shares this client.
 */
export async function fetchAvatar(
  username: string,
  fetchImpl: Fetcher = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(playerUrl(username));
    if (!response.ok) return null;
    const body = (await response.json()) as { avatar?: string };
    return body.avatar ?? null;
  } catch {
    return null;
  }
}

/**
 * What `/stats` says about the account: what it is rated per game type, and how many games
 * it has ever finished in each.
 *
 * A type with no entry is one the profile did not speak for — never played, or not listed.
 * Left out rather than sent as `0`, because "never played" and "played none, rated 0" are
 * not the same thing and only one of them is true.
 */
export type Stats = { ratings: Ratings; totals: Totals };

/** Games ever finished per game type: the sum of the profile's win/loss/draw record. */
export type Totals = Partial<Record<GameType, number>>;

/**
 * The account's profile stats, or `null` if they cannot be read.
 *
 * `https://api.chess.com/pub/player/{username}/stats` — 400 bytes gzipped, against a
 * megabyte of archive, and it answers two questions at once.
 *
 * **The ratings** are the fallback and not the answer: a game type played in a month we
 * fetch is rated by the archive, in the same read as its count. This is for the types with
 * no game there to be rated by.
 *
 * **The totals** are the reason this is now on the counting path rather than off to one
 * side on a timer. `record` is chess.com's own counter, and it is a different number
 * reaching us by a different road than the archive — which is exactly what makes it worth
 * having. When it moves and the archive does not, we know the archive is behind rather
 * than empty, and the day's count can say so instead of quietly coming up short. See
 * `pendingOf` in `state/sync.ts`.
 *
 * Lifetime figures, note, not today's: only the *change* in them means anything here.
 *
 * `no-store` for the reason the archive request has it: the answer is being asked again
 * because it may have changed, and the copy in the browser's cache is by definition the
 * one from before.
 *
 * Never throws, for the reason `fetchAvatar` does not: it shares this client with the
 * counting, and a profile that will not load must not take the counting down with it. A
 * `null` leaves every caller on the last thing it knew, which for the totals means no
 * movement seen — never a movement invented.
 */
export async function fetchStats(
  username: string,
  fetchImpl: Fetcher = fetch,
): Promise<Stats | null> {
  try {
    const response = await fetchImpl(`${playerUrl(username)}/stats`, { cache: 'no-store' });
    if (!response.ok) return null;

    const body = (await response.json()) as Record<
      string,
      { last?: { rating?: number }; record?: Record<string, number> }
    >;

    const ratings: Ratings = {};
    const totals: Totals = {};
    for (const gameType of GAME_TYPES) {
      const entry = body[`chess_${gameType}`];

      const rating = entry?.last?.rating;
      if (typeof rating === 'number') ratings[gameType] = rating;

      // Summed over whatever keys the record carries rather than over `win`, `loss` and
      // `draw` by name: a fourth outcome appearing one day should raise the total, not be
      // silently dropped — a total that is short is a game the archive looks late with.
      const record = entry?.record;
      if (record !== undefined) {
        const played = Object.values(record).filter((n) => typeof n === 'number');
        if (played.length > 0) totals[gameType] = played.reduce((a, b) => a + b, 0);
      }
    }
    return { ratings, totals };
  } catch {
    return null;
  }
}
