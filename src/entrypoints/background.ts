import { evaluate, type Decision } from '../core/policy';
import { GAME_TYPES, type GameType } from '../core/types';
import type { Message, Status } from '../messaging';
import { fetchAvatar } from '../api/chesscom-api';
import { avatarItem, getSettings, rememberDetectedUsername } from '../state/storage';
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
}

/** Fetched once per account. Cosmetic, so it never blocks answering the content script. */
async function refreshAvatar(username: string, accountChanged: boolean): Promise<void> {
  if (!accountChanged && (await avatarItem.getValue()) !== null) return;
  await avatarItem.setValue(await fetchAvatar(username));
}

async function handle(message: Message): Promise<Status> {
  const now = Date.now();
  const settings = await getSettings();

  // A different signed-in account invalidates what we stored, so re-query immediately.
  const accountChanged =
    message.username != null && (await rememberDetectedUsername(message.username));

  if (message.username != null) void refreshAvatar(message.username, accountChanged);

  const outcome = await syncDay({ now, force: accountChanged || message.force === true });

  const decisions = Object.fromEntries(
    GAME_TYPES.map((gameType) => [
      gameType,
      evaluate({ state: outcome.state, settings, gameType, now }),
    ]),
  ) as Record<GameType, Decision>;

  // Deliberately independent of the quota: rematch is its own rule with its own switch.
  return { decisions, blockRematch: settings.blockRematch };
}
