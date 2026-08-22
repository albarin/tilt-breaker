import { evaluate, gapBlock, summarize, type Decision } from '../core/policy';
import { ARCHIVE_DELAY_MS, awaitingArchive, newestCounted } from '../core/games';
import { dayKeyOf, dayStartMs } from '../core/day';
import { DAY_RESET_HOUR, GAME_TYPES, type DayState, type GameType } from '../core/types';
import type { Message, Status } from '../messaging';
import { fetchAvatar, fetchStats } from '../api/chesscom-api';
import {
  avatarItem,
  detectedUsernameItem,
  getRatings,
  getSettings,
  rememberDetectedUsername,
  rememberFinishedGame,
  rememberLastGameEnd,
  rememberRatings,
} from '../state/storage';
import { syncDay } from '../state/sync';

const REFRESH_ALARM = 'refresh';
const REFRESH_MINUTES = 30;

/**
 * When to look again after a game is reported as finished.
 *
 * The content script tells us the moment a game ends; chess.com's archive publishes it a
 * few seconds later. One read at the moment of the report — which is what this used to do
 * — is therefore a read that is certain to be too early.
 *
 * Tight at the start and stretching out, because that is where the answer usually is: the
 * first four reads are inside seven seconds, and each one is a conditional request the
 * server answers 304 with no body at all.
 *
 * It adds up to four and a half minutes, against the five that `ARCHIVE_DELAY_MS` calls
 * the outer edge of "any moment now". The chain used to stop at two, and a game published
 * after that waited for the half-hourly refresh — half an hour of a count that was short
 * by the game you had opened the popup to see.
 */
const CATCH_UP_MS = [
  1_000, 1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 34_000, 55_000, 60_000, 60_000,
];

/**
 * Which of those reads asks for the month in full rather than conditionally.
 *
 * A conditional request cannot see past a validator that answers "nothing changed", and
 * nothing else in the chain can tell that answer apart from the truth. So a few of them —
 * the twelfth second, the fifty-fourth, and once more after three minutes — pay for a
 * whole month rather than leave a game we know has ended sitting behind a 304.
 */
const FULL_READS = new Set([4, 7, 10]);

/**
 * The same job, once, for after the worker is gone.
 *
 * A service worker is killed when it goes idle, taking the timers above with it. Chrome
 * will not schedule an alarm sooner than 30 seconds, which is why this backs the chain up
 * rather than replacing it — and why it resumes the chase rather than reading once: the
 * game that had not arrived when the worker died is exactly the one still to wait for.
 */
const CATCH_UP_ALARM = 'catch-up';

/**
 * The background is the only place that decides. It queries chess.com's public archive,
 * which is what actually knows how many games you have played and how they ended, and
 * answers the content script whether another one is allowed.
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: Message, _sender: unknown, sendResponse: (response: unknown) => void) => {
      handle(message).then(sendResponse, (error: unknown) => {
        console.error('[tilt-breaker] failed to handle message', error);
        sendResponse(undefined);
      });
      // Chrome requires `true` to answer asynchronously; Firefox accepts it too.
      return true;
    },
  );

  // Keeps the snapshot warm with no chess.com tab open, so the popup has something
  // current the moment you open it.
  browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) void refresh();
    if (alarm.name === CATCH_UP_ALARM) void resumeCatchUp();
  });
  browser.runtime.onStartup.addListener(() => void refresh());
  browser.runtime.onInstalled.addListener(() => void refresh());
});

async function refresh(): Promise<void> {
  const outcome = await syncDay({ now: Date.now(), force: true });
  if (!outcome.ok) console.info('[tilt-breaker] refresh failed:', outcome.reason, outcome.detail);

  // Picks up an avatar that a failed fetch left missing. Without this, one bad request
  // would leave it blank until the account changed.
  const username = await detectedUsernameItem.getValue();
  if (username === null) return;
  await Promise.all([refreshAvatar(username, false), refreshRatings(username, true)]);
}

/**
 * Reads the archive again, and again, until the game that has just ended is in it.
 *
 * `counted` is how far the count reached at the moment the game was reported. Anything
 * newer than that is the game we are waiting for, which is the only thing that can appear:
 * you are not playing another one while this runs.
 *
 * Never awaited by the caller — the content script gets its answer from the read that has
 * already happened, and this goes on in the background so the popup finds the day correct
 * rather than having to wait for it.
 */
async function catchUp(counted: number): Promise<void> {
  const startedAt = Date.now();
  browser.alarms.create(CATCH_UP_ALARM, { delayInMinutes: 0.5 });

  for (const [round, delay] of CATCH_UP_MS.entries()) {
    await new Promise((done) => setTimeout(done, delay));

    const now = Date.now();
    if (now - startedAt > ARCHIVE_DELAY_MS) break;

    const outcome = await syncDay({ now, force: true, fresh: FULL_READS.has(round) });
    // Both halves of the question, not just the stamp: a game can arrive in the archive
    // while another one chess.com has counted is still missing, and stopping on the first
    // would leave the second to the half-hourly refresh.
    if (newestCounted(outcome.state.games) > counted && !awaitingPublication(outcome.state, now)) {
      await browser.alarms.clear(CATCH_UP_ALARM);
      return;
    }
  }
}

/**
 * Is the count knowably behind — a game of yours has ended and the archive has not
 * published it yet? The one question both the chase and the popup's notice turn on, asked
 * in one place so they cannot disagree about it.
 *
 * Two ways to know it, and they cover different holes. The page told us a game ended,
 * which needs a chess.com tab open and reaches only a few minutes past the ending. Or
 * chess.com's own record counts a game the archive has not listed, which needs nothing
 * open, catches games played on the phone, and holds for as long as the archive stays
 * behind — which on 22 Aug 2026 was hours.
 */
function awaitingPublication(state: DayState, now: number): boolean {
  if (GAME_TYPES.some((gameType) => (state.pending?.[gameType] ?? 0) > 0)) return true;

  return awaitingArchive({
    lastGameEndedAt: state.lastGameEndedAt,
    counted: newestCounted(state.games),
    dayStart: dayStartMs(dayKeyOf(now, DAY_RESET_HOUR), DAY_RESET_HOUR),
    now,
  });
}

/**
 * Picks the chase back up after the worker was killed in the middle of it.
 *
 * Reads in full rather than conditionally: this runs at least half a minute after the
 * game was reported, which is long past the point where "nothing changed" is the answer
 * to believe. If the game is in by now there is nothing to resume, and if it is not, the
 * chase starts again — bounded by the same five minutes, after which a game that has not
 * appeared is one that never will.
 */
async function resumeCatchUp(): Promise<void> {
  const outcome = await syncDay({ now: Date.now(), force: true, fresh: true });
  if (!awaitingPublication(outcome.state, Date.now())) return;

  await catchUp(newestCounted(outcome.state.games));
}

/** Fetched once per account. Cosmetic, so it never blocks answering the content script. */
async function refreshAvatar(username: string, accountChanged: boolean): Promise<void> {
  if (!accountChanged && (await avatarItem.getValue()) !== null) return;
  await avatarItem.setValue(await fetchAvatar(username));
}

/**
 * The profile's ratings, which are the fallback and not the answer: a game type played in
 * a month we fetch is rated by the archive, in the same read as its count, and this is for
 * the ones with no game there to be rated by.
 *
 * So it runs on the timer and on a new sign-in, and nothing hangs on how soon it lands.
 * It used to be the only source, and being fetched on its own schedule is precisely what
 * left the number beside a game type a game behind the count beside it.
 *
 * Unforced it only fills a gap, because it runs off every message the content script sends.
 */
async function refreshRatings(username: string, force: boolean): Promise<void> {
  if (!force && (await getRatings())?.username === username) return;

  const stats = await fetchStats(username);
  if (stats !== null) await rememberRatings(username, 'profile', stats.ratings);
}

async function handle(message: Message): Promise<Status> {
  const now = Date.now();
  // Nothing below reads the settings until the sync is done, so the read rides alongside
  // it instead of delaying it. The writes that follow are not so free: syncDay reads the
  // very keys they set, so they stay ordered ahead of it.
  const pendingSettings = getSettings();

  // A different signed-in account invalidates what we stored, so re-query immediately.
  const accountChanged =
    message.username != null && (await rememberDetectedUsername(message.username));

  if (message.username != null) {
    void refreshAvatar(message.username, accountChanged);
    void refreshRatings(message.username, accountChanged);
  }

  // Recorded before asking the API, which will not know about it for a few seconds yet.
  // rememberLastGameEnd never moves backwards, so the archive can only confirm this.
  if (message.gameEnded === true) await rememberLastGameEnd(now);

  // Ordered ahead of the sync for the same reason: the sync reads this and must see the
  // game that has just been reported, or the count it answers with is the one from before.
  if (message.finished !== undefined) {
    await rememberFinishedGame(message.finished.id, message.finished.gameType);
  }

  const [settings, outcome] = await Promise.all([
    pendingSettings,
    syncDay({ now, force: accountChanged || message.force === true }),
  ]);

  const decisions = Object.fromEntries(
    GAME_TYPES.map((gameType) => [
      gameType,
      evaluate({ state: outcome.state, settings, gameType, now }),
    ]),
  ) as Record<GameType, Decision>;

  // Deliberately independent of the quota: rematch is its own rule with its own switch.
  const status: Status = { decisions, blockRematch: settings.blockRematch };

  // The read above was made seconds after the game ended, which is too early for the
  // archive to have it. Keep looking, without holding up the answer.
  if (message.gameEnded === true) void catchUp(newestCounted(outcome.state.games));

  // The popup's view is computed here and not in the popup: syncing from two contexts
  // would race the storage write queue, which serialises within one context only.
  if (message.view === true) {
    const gap = gapBlock(outcome.state, settings, now);
    const settling = awaitingPublication(outcome.state, now);
    status.view = {
      rows: summarize(outcome.state, settings, now),
      ...(gap === null ? {} : { gapUntil: gap.until }),
      ...(outcome.ok ? {} : { problem: outcome.reason }),
      ...(settling ? { settling: true as const } : {}),
    };
  }
  return status;
}
