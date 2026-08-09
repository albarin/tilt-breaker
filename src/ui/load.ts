import { summarize, type GameTypeSummary } from '../core/policy';
import { getSettings } from '../state/storage';
import { syncDay } from '../state/sync';

export type View = {
  rows: GameTypeSummary[];
  /** Set when the API could not be consulted; the rows are the last thing we knew. */
  problem?: 'no-account' | 'network-error';
};

/** Everything the popup needs to render, in one call. */
export async function loadView(now = Date.now()): Promise<View> {
  const settings = await getSettings();
  const outcome = await syncDay({ now, force: true });
  return {
    rows: summarize(outcome.state, settings, now),
    ...(outcome.ok ? {} : { problem: outcome.reason }),
  };
}
