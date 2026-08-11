import { i18n } from '#i18n';
import { isOff, type GameTypeSummary } from '../core/policy';
import type { GameType } from '../core/types';

/**
 * Display names, as chess.com writes them.
 *
 * Deliberately not translated and deliberately not in the catalogues: these are the app's
 * names for the three modes, they are what the site itself shows next to the buttons we
 * block, and players say them in every language. Being proper nouns, they also keep their
 * capital wherever a sentence drops them.
 */
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

/**
 * Built on first use rather than at import: it reads the UI language, and a module
 * evaluating `browser.i18n` the moment it is imported is a needless ordering constraint.
 * Cached because the language cannot change without restarting the browser.
 */
let hhmm: Intl.DateTimeFormat | null = null;

function clock(): Intl.DateTimeFormat {
  return (hhmm ??= new Intl.DateTimeFormat(browser.i18n.getUILanguage(), {
    hour: '2-digit',
    minute: '2-digit',
  }));
}

/**
 * Every time shown anywhere goes through here.
 *
 * Two decisions used to be frozen in this line: `en-GB`, and an `h` welded onto the
 * result. Neither travels — 24-hour clocks are not universal, and the `h` is a Spanish
 * convention that would be wrong on "4:00 PM". Now `Intl` reads the UI language for the
 * shape of the time, and the catalogue decides what wraps it.
 *
 * But the catalogue cannot make that call on its own, because it does not get to see the
 * clock. The browser picks it by language — `es-MX` reads the same Spanish catalogue as
 * `es-ES`, `h` and all — and `Intl` picks the shape by region, which for most of Latin
 * America is 12-hour. Wrapping unconditionally is what produced "09:05 p.m.h". So the
 * suffix is only asked for on a 24-hour clock, the only shape it was ever a convention
 * for; on a 12-hour one the time is shown as `Intl` wrote it.
 */
export function formatTime(ms: number): string {
  const format = clock();
  const time = format.format(ms);
  return format.resolvedOptions().hour12 === true ? time : i18n.t('common.time', [time]);
}

/** Why that game type is blocked, or `null` if it can be played. */
export function blockReason(row: GameTypeSummary): string | null {
  const { decision, limit } = row;
  if (decision.allow) return null;
  if (decision.reason === 'tilt') return i18n.t('popup.reason.tilt', [formatTime(decision.until)]);
  if (decision.reason === 'gap') return i18n.t('popup.reason.gap', [formatTime(decision.until)]);
  return isOff(limit) ? i18n.t('popup.reason.quotaOff') : i18n.t('popup.reason.quota');
}

/**
 * How much of the quota is used, from 0 to 1.
 *
 * A quota of 0 renders full: there is nothing left to spend. Going over the quota — the
 * API can return games we had not counted — does not overflow the bar.
 */
export function usedFraction(row: GameTypeSummary): number {
  if (row.limit === null) return 0;
  if (isOff(row.limit)) return 1;
  return Math.min(1, row.used / row.limit);
}
