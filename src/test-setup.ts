import { afterEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/**
 * Makes the storage double refuse what a real browser refuses.
 *
 * `browser.storage` structured-clones everything it is handed, and the fake does not: it
 * keeps the reference. That gap shipped a bug — the settings page passed reactive state,
 * which is a proxy, and proxies cannot be cloned. Every write rejected in the browser
 * while the whole suite stayed green, because in tests nothing ever tried to clone.
 *
 * Cloning here rather than in each test is the point: a check the tests cannot forget to
 * make is worth more than one they have to remember.
 */
function enforceStructuredClone(): void {
  for (const area of ['local', 'sync', 'session', 'managed'] as const) {
    const storageArea = fakeBrowser.storage[area] as
      { set?: (items: Record<string, unknown>) => Promise<void> } | undefined;
    const original = storageArea?.set;
    if (storageArea === undefined || original === undefined) continue;

    storageArea.set = (items: Record<string, unknown>) => {
      try {
        // Fails on anything the browser could not store, before the fake accepts it.
        structuredClone(items);
      } catch (error) {
        // Rejected, not thrown: the real API is asynchronous and so is its refusal.
        return Promise.reject(error);
      }
      return original.call(storageArea, items);
    };
  }
}

enforceStructuredClone();

// `reset()` may hand back untouched objects, so the wrap is re-applied after each one.
afterEach(() => enforceStructuredClone());
