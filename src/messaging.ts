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
  /**
   * Which game ended, when the page could say.
   *
   * The id is chess.com's own, the same one the archive will file the game under, so the
   * provisional count it starts is retired by identity rather than by guessing from
   * timestamps. Absent when the modal named no time control, and then nothing is counted
   * — never a guess at which quota to spend.
   */
  finished?: { id: string; gameType: GameType };
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
  /**
   * A game has ended and the archive has not published it yet, so the rows are short by
   * exactly that one. Said out loud rather than left to be noticed: the alternative is
   * numbers that look settled and are not.
   */
  settling?: true;
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
