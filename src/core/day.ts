/**
 * The extension's day starts at whatever hour it is told (`resetHour`), which today is
 * midnight. It stays parameterised because that is what lets the tests exercise daylight
 * saving transitions without depending on the value currently in force.
 *
 * All arithmetic is wall-clock (`setHours`, never subtracting milliseconds) so the cut
 * lands on the same local hour even on the days that last 23 or 25 hours.
 */

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Local day key (`'2026-08-08'`) that a given instant belongs to. */
export function dayKeyOf(timestamp: number, resetHour: number): string {
  const d = new Date(timestamp);
  d.setHours(d.getHours() - resetHour);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDayKey(dayKey: string): [number, number, number] {
  const parts = dayKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`invalid day key: ${dayKey}`);
  }
  const [y, m, d] = parts as [number, number, number];
  return [y, m - 1, d];
}

/** When `dayKey` starts, in epoch ms. */
export function dayStartMs(dayKey: string, resetHour: number): number {
  const [y, m, d] = parseDayKey(dayKey);
  return new Date(y, m, d, resetHour, 0, 0, 0).getTime();
}

/** When `dayKey` ends, which is when the next one starts. */
export function dayEndMs(dayKey: string, resetHour: number): number {
  const [y, m, d] = parseDayKey(dayKey);
  return new Date(y, m, d + 1, resetHour, 0, 0, 0).getTime();
}
