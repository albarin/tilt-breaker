import type { GameType } from './types';

export type TimeControl = { base: number; increment: number };

/**
 * chess.com's rule: estimate the game length over a nominal 40 moves (FIDE),
 * `base + 40 × increment`, then cut at 3 and 10 minutes.
 *
 * The boundaries are closed from below: `3|0` is exactly 180s and counts as blitz, not
 * bullet; `10|0` is exactly 600s and counts as rapid, not blitz.
 */
export function classify({ base, increment }: TimeControl): GameType {
  const estimated = base + 40 * increment;
  if (estimated < 180) return 'bullet';
  if (estimated < 600) return 'blitz';
  return 'rapid';
}

/**
 * Reads a time control off a chess.com lobby label and classifies it.
 *
 * Labels are in **minutes**, with increment seconds after the separator: `"1 min"`,
 * `"3 + 2"`, `"10 + 5"`. Correspondence labels (`"1 day"`, `"3 days"`) return `null`.
 */
export function gameTypeFromLabel(raw: string | null | undefined): GameType | null {
  const text = raw?.trim();
  if (!text) return null;
  const match = /^(\d+)\s*(?:[|/+]\s*(\d+))?(?:\s*min)?$/i.exec(text);
  if (match === null) return null;
  return classify({ base: Number(match[1]) * 60, increment: Number(match[2] ?? 0) });
}

/**
 * The game type a next-game button starts, from a label that says more than the control:
 * `"New 15 + 10"`, `"New 1 min"`.
 *
 * The time control is picked out of the sentence rather than the sentence being parsed,
 * because the sentence is language and the control is not. Which is the point: it is what
 * tells a button that starts a game from one that does not, in a panel where chess.com
 * gives the two the same class and only the words differ.
 *
 * `null` for a label carrying no control — "Highlights", "Rematch" — and for a
 * correspondence one, which is never limited.
 */
export function gameTypeFromNewGameLabel(raw: string | null | undefined): GameType | null {
  const control = /\d+\s*[|/+]\s*\d+|\d+\s*min\b/i.exec(raw ?? '')?.[0];
  return gameTypeFromLabel(control);
}
