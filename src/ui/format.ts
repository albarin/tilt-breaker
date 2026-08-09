import type { GameTypeSummary } from '../core/policy';
import type { GameType } from '../core/types';

/** Display names, as chess.com writes them. */
export const NAMES: Record<GameType, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
};

/** One colour per game type, so they are told apart without reading the name. */
export const COLORS: Record<GameType, string> = {
  bullet: '#d08a3e',
  blitz: '#f0c236',
  rapid: '#81b64c',
};

const hhmm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function formatTime(ms: number): string {
  return hhmm.format(ms);
}

/** Why that game type is blocked, or `null` if it can be played. */
export function blockReason(row: GameTypeSummary): string | null {
  const { decision, limit } = row;
  if (decision.allow) return null;
  if (decision.reason === 'tilt') return `resting until ${formatTime(decision.until)}`;
  // A quota of 0 was never spent: it is switched off from the start.
  return limit === 0 ? 'off for today' : 'done for today';
}

/**
 * How much of the quota is used, from 0 to 1.
 *
 * A quota of 0 renders full: there is nothing left to spend. Going over the quota — the
 * API can return games we had not counted — does not overflow the bar.
 */
export function usedFraction(row: GameTypeSummary): number {
  if (row.limit === null) return 0;
  if (row.limit === 0) return 1;
  return Math.min(1, row.used / row.limit);
}
