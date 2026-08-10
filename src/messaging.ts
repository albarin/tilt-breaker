import type { Decision, GameTypeSummary } from './core/policy';
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
  /**
   * A game of yours has just finished, right now.
   *
   * The archive takes a few seconds to publish it, and the gap between games has to start
   * at once — otherwise it is measured from the previous game, which after a long one has
   * already expired.
   */
  gameEnded?: boolean;
  /** Also answer with a {@link View}. What the popup asks for. */
  view?: boolean;
};

/** Everything the popup needs to render, in one answer. */
export type View = {
  rows: GameTypeSummary[];
  /** When the gap between games lifts. Global, so it is shown once and not per row. */
  gapUntil?: number;
  /** Set when the API could not be consulted; the rows are the last thing we knew. */
  problem?: 'no-account' | 'network-error';
};

export type Status = {
  decisions: Record<GameType, Decision>;
  /** Whether rematch is blocked. Independent of the quota: it is a separate rule. */
  blockRematch: boolean;
  /** Present when the message asked for it. */
  view?: View;
};

export function sendMessage(message: Message): Promise<Status> {
  return browser.runtime.sendMessage(message) as Promise<Status>;
}
