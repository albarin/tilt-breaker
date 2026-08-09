import { gapBlock, summarize, type GameTypeSummary } from '../core/policy';
import { getSettings } from '../state/storage';
import { syncDay } from '../state/sync';

export type View = {
  rows: GameTypeSummary[];
  /** When the gap between games lifts. Global, so it is shown once and not per row. */
  gapUntil?: number;
  /** Set when the API could not be consulted; the rows are the last thing we knew. */
  problem?: 'no-account' | 'network-error';
};

/** Everything the popup needs to render, in one call. */
export async function loadView(now = Date.now()): Promise<View> {
  const settings = await getSettings();
  const outcome = await syncDay({ now, force: true });
  const gap = gapBlock(outcome.state, settings, now);
  return {
    rows: summarize(outcome.state, settings, now),
    ...(gap === null ? {} : { gapUntil: gap.until }),
    ...(outcome.ok ? {} : { problem: outcome.reason }),
  };
}
