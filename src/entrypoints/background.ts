import { evaluate, gapBlock, summarize, type Decision } from '../core/policy';
import { awaitingArchive, newestCounted } from '../core/games';
import { dayKeyOf, dayStartMs } from '../core/day';
import { DAY_RESET_HOUR, GAME_TYPES, type GameType } from '../core/types';
import type { Message, Status } from '../messaging';
import { fetchAvatar, fetchRatings } from '../api/chesscom-api';
import {
  avatarItem,
  detectedUsernameItem,
  getSettings,
  ratingsItem,
  rememberDetectedUsername,
  rememberLastGameEnd,
} from '../state/storage';
import { syncDay } from '../state/sync';

const REFRESH_ALARM = 'refresh';
const REFRESH_MINUTES = 30;

/**
 * When to look again after a game is reported as finished.
 *
 * The content script tells us the moment a game ends; chess.com's archive publishes it a
 * few seconds later. One read at the moment of the report — which is what this used to do
 * — is therefore a read that is certain to be too early, and the next scheduled one is
 * half an hour away. So the report starts a short chain of re-reads, and they stop the
 * moment the game shows up.
 *
 * Spaced out rather than tight: each one is a conditional request the server answers 304
 * until there is something new, and the tail is there for the times it takes a minute.
 */
const CATCH_UP_MS = [4_000, 8_000, 15_000, 30_000, 60_000];

/**
 * The same job, once, for after the worker is gone.
 *
 * A service worker is killed when it goes idle, taking the timers above with it. Chrome
 * will not schedule an alarm sooner than 30 seconds, which is why this backs the chain up
 * rather than replacing it.
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
    if (alarm.name === REFRESH_ALARM || alarm.name === CATCH_UP_ALARM) void refresh();
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
  browser.alarms.create(CATCH_UP_ALARM, { delayInMinutes: 0.5 });

  for (const delay of CATCH_UP_MS) {
    await new Promise((done) => setTimeout(done, delay));
    const outcome = await syncDay({ now: Date.now(), force: true });
    if (newestCounted(outcome.state.games) > counted) {
      // That game moved a rating, and this is the moment it is published. Read again now
      // rather than at the next half-hourly refresh: the popup you open straight after a
      // game is the one where a stale number would be noticed.
      const username = await detectedUsernameItem.getValue();
      if (username !== null) void refreshRatings(username, true);
      return;
    }
  }
}

/** Fetched once per account. Cosmetic, so it never blocks answering the content script. */
async function refreshAvatar(username: string, accountChanged: boolean): Promise<void> {
  if (!accountChanged && (await avatarItem.getValue()) !== null) return;
  await avatarItem.setValue(await fetchAvatar(username));
}

/**
 * Ratings for the account, refetched rather than fetched once like the avatar: they are
 * the one part of a profile that moves, and they move for exactly the games being counted.
 *
 * Unforced it only fills a gap — a fresh install, or a different sign-in — because it runs
 * off every message the content script sends. What keeps it current is the two moments
 * that can have changed it: the scheduled refresh, and a game landing in the archive.
 */
async function refreshRatings(username: string, force: boolean): Promise<void> {
  if (!force && (await ratingsItem.getValue())?.username === username) return;

  const ratings = await fetchRatings(username);
  if (ratings !== null) await ratingsItem.setValue({ username, ratings });
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
    const settling = awaitingArchive({
      lastGameEndedAt: outcome.state.lastGameEndedAt,
      counted: newestCounted(outcome.state.games),
      dayStart: dayStartMs(dayKeyOf(now, DAY_RESET_HOUR), DAY_RESET_HOUR),
      now,
    });
    status.view = {
      rows: summarize(outcome.state, settings, now),
      ...(gap === null ? {} : { gapUntil: gap.until }),
      ...(outcome.ok ? {} : { problem: outcome.reason }),
      ...(settling ? { settling: true as const } : {}),
    };
  }
  return status;
}
