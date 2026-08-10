import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings, rememberDetectedUsername, rememberLastGameEnd, setSettings } from './storage';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings', () => {
  it('starts from the defaults', async () => {
    const settings = await getSettings();
    expect(settings.limits).toEqual({ bullet: 8, blitz: 6, rapid: 3 });
    expect(settings.gapMinutes).toBe(15);
    expect(settings.blockRematch).toBe(true);
  });

  it('merges partial changes without dropping the rest', async () => {
    await setSettings({ gapMinutes: 30 });
    await setSettings({ blockRematch: false });
    const settings = await getSettings();
    expect(settings.gapMinutes).toBe(30);
    expect(settings.blockRematch).toBe(false);
    expect(settings.limits.blitz).toBe(6);
  });

  /** So a setting added in a later version reaches installs that predate it. */
  it('fills in keys missing from what was stored', async () => {
    await fakeBrowser.storage.local.set({ settings: { gapMinutes: 5 } });
    const settings = await getSettings();
    expect(settings.gapMinutes).toBe(5);
    expect(settings.tilt).toEqual({ losses: 3 });
    expect(settings.blockRematch).toBe(true);
  });

  /**
   * A game type the stored settings predate must not come back `undefined`: that is
   * neither a number nor "no limit", and it blocks the type outright.
   */
  it('fills in a game type missing from the stored limits', async () => {
    await fakeBrowser.storage.local.set({ settings: { limits: { bullet: 1 } } });
    const settings = await getSettings();
    expect(settings.limits).toEqual({ bullet: 1, blitz: 6, rapid: 3 });
  });

  it('a deliberate no-limit survives that merge', async () => {
    await setSettings({ limits: { bullet: 8, blitz: 6, rapid: null } });
    expect((await getSettings()).limits.rapid).toBeNull();
  });

  // Every read-modify-write here is serialised, so concurrent ones cannot lose each other.
  it('concurrent changes do not overwrite one another', async () => {
    await Promise.all([
      setSettings({ gapMinutes: 30 }),
      setSettings({ blockRematch: false }),
      setSettings({ tilt: { losses: 5 } }),
    ]);
    const settings = await getSettings();
    expect(settings.gapMinutes).toBe(30);
    expect(settings.blockRematch).toBe(false);
    expect(settings.tilt.losses).toBe(5);
  });
});

describe('rememberLastGameEnd', () => {
  it('keeps the latest end', async () => {
    await rememberLastGameEnd(1000);
    await expect(rememberLastGameEnd(2000)).resolves.toBe(2000);
  });

  it('never goes backwards', async () => {
    await rememberLastGameEnd(2000);
    await expect(rememberLastGameEnd(1000)).resolves.toBe(2000);
  });

  it('null leaves it alone', async () => {
    await rememberLastGameEnd(2000);
    await expect(rememberLastGameEnd(null)).resolves.toBe(2000);
  });

  /**
   * Several chess.com tabs sync at once. Unserialised, the later write could lose to the
   * earlier one and the gap between games would be under-enforced.
   */
  it('concurrent writes still end on the maximum', async () => {
    await Promise.all([1000, 5000, 3000, 2000].map(rememberLastGameEnd));
    await expect(rememberLastGameEnd(null)).resolves.toBe(5000);
  });
});

describe('rememberDetectedUsername', () => {
  it('reports whether the account changed', async () => {
    await expect(rememberDetectedUsername('alba')).resolves.toBe(true);
    await expect(rememberDetectedUsername('alba')).resolves.toBe(false);
    await expect(rememberDetectedUsername('otra')).resolves.toBe(true);
  });
});
