import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The setup is only worth having if it actually bites, and it has to keep biting after
 * `reset()`, which every other test file calls before each test.
 */
describe('the storage double refuses what the browser refuses', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('rejects a value that could not be stored for real', async () => {
    const proxy = new Proxy({ bullet: 1 }, {});
    await expect(fakeBrowser.storage.local.set({ settings: proxy })).rejects.toThrow(
      /could not be cloned/i,
    );
  });

  it('and still rejects it after a reset', async () => {
    fakeBrowser.reset();
    const proxy = new Proxy({ bullet: 1 }, {});
    await expect(fakeBrowser.storage.local.set({ settings: proxy })).rejects.toThrow();
  });

  it('while plain data goes through untouched', async () => {
    await fakeBrowser.storage.local.set({ settings: { limits: { bullet: 1 } } });
    const back = await fakeBrowser.storage.local.get('settings');
    expect(back.settings).toEqual({ limits: { bullet: 1 } });
  });
});
