import type { ApiGame } from '../core/games';

/**
 * Client for chess.com's public monthly archive.
 *
 * `https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}`
 *
 * No key, no session: it is public data. This is where the extension's counts come from,
 * so it knows the real game type and result instead of guessing from the page.
 *
 * Measured against the live server: it answers `cache-control: public, max-age=5` and a
 * game shows up in the archive seconds after it ends. The 12-hour refresh the docs
 * mention belongs to other endpoints, not this one.
 *
 * The archive is large (~1 MB mid-month, ~280 KB over the wire), and this is polled every
 * few seconds while a finished game is on its way — so requests are conditional and the
 * server answers 304 with no body when you have not played since last time.
 *
 * Conditional on the **ETag**, not on `Last-Modified`. The server sends both, but measured
 * against it, `If-Modified-Since` is ignored: echoing its own stamp back — in its own
 * format, in RFC 1123, or a second earlier — answers 200 with the whole archive every
 * time. `If-None-Match` answers 304. So the caching this file claimed to do was not
 * happening at all: every sync downloaded and parsed the full month, which on a slow
 * connection is most of the wait after a game ends.
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

export function archiveUrl(username: string, month: Month): string {
  return `${playerUrl(username)}/games/${monthKey(month).replace('-', '/')}`;
}

/** `ETag`s per month, so we only ask for what changed. */
export type Etags = Record<string, string>;

export type ArchiveResult = {
  games: ApiGame[];
  /** `true` when **every** month answered 304: the caller can keep its cache. */
  unchanged: boolean;
  etags: Etags;
};

/**
 * Downloads one monthly archive.
 *
 * A 404 means "you did not play that month", which is not an error. Anything else throws:
 * we never invent an empty list, because an empty list would look like "no games today"
 * and would lift the block.
 */
async function fetchMonth(
  username: string,
  month: Month,
  previous: string | undefined,
  fetchImpl: Fetcher,
): Promise<{ games: ApiGame[] | null; etag?: string }> {
  const response = await fetchImpl(archiveUrl(username, month), {
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

  if (response.status === 304) return { games: null, etag: previous };
  if (response.status === 404) return { games: [] };
  if (!response.ok) throw new Error(`chess.com API responded ${response.status}`);

  const body = (await response.json()) as { games?: ApiGame[] };
  const etag = response.headers.get('etag') ?? undefined;
  return { games: body.games ?? [], ...(etag === undefined ? {} : { etag }) };
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
