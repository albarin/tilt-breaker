import type { Decision } from './core/policy';
import type { GameType } from './core/types';

/**
 * The content script counts nothing and decides nothing: it asks and enforces. All
 * counting comes from chess.com's public API, which the background queries.
 */
export type Message = {
  /** Skip the cache TTL. Used when the page changes. */
  force?: boolean;
  /** The signed-in account, read from the site's sidebar. */
  username?: string | null;
};

export type Status = {
  decisions: Record<GameType, Decision>;
  /** Whether rematch is blocked. Independent of the quota: it is a separate rule. */
  blockRematch: boolean;
};

export function sendMessage(message: Message): Promise<Status> {
  return browser.runtime.sendMessage(message) as Promise<Status>;
}
