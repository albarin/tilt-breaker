import { evaluate, gapBlock, summarize, type Decision } from '../core/policy';
import { GAME_TYPES, type GameType } from '../core/types';
import type { Message, Status } from '../messaging';
import { fetchAvatar } from '../api/chesscom-api';
import {
  avatarItem,
  detectedUsernameItem,
  getSettings,
  rememberDetectedUsername,
  rememberLastGameEnd,
} from '../state/storage';
import { syncDay } from '../state/sync';

const REFRESH_ALARM = 'refresh';
const REFRESH_MINUTES = 30;

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
  if (username !== null) await refreshAvatar(username, false);
}

/** Fetched once per account. Cosmetic, so it never blocks answering the content script. */
async function refreshAvatar(username: string, accountChanged: boolean): Promise<void> {
  if (!accountChanged && (await avatarItem.getValue()) !== null) return;
  await avatarItem.setValue(await fetchAvatar(username));
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

  if (message.username != null) void refreshAvatar(message.username, accountChanged);

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

  // The popup's view is computed here and not in the popup: syncing from two contexts
  // would race the storage write queue, which serialises within one context only.
  if (message.view === true) {
    const gap = gapBlock(outcome.state, settings, now);
    status.view = {
      rows: summarize(outcome.state, settings, now),
      ...(gap === null ? {} : { gapUntil: gap.until }),
      ...(outcome.ok ? {} : { problem: outcome.reason }),
    };
  }
  return status;
}
