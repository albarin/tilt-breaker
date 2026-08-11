import { afterEach } from 'vitest';
import { generateChromeMessages, parseMessagesFile } from '@wxt-dev/i18n/build';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/**
 * The language the tests run in.
 *
 * Pinned like `TZ` is in the test script, and for the same reason: times are formatted
 * from the UI language now, so leaving it to the machine would make the suite pass or
 * fail depending on whose laptop it runs on. `en-GB` keeps the 24-hour clock the
 * assertions are written against.
 */
export const TEST_UI_LANGUAGE = 'en-GB';

/**
 * Gives the fake browser the `i18n` the real one has.
 *
 * `fakeBrowser` implements no `i18n` whatsoever, so every string in the app would throw
 * on the way to being rendered. The English catalogue is compiled here by the same code
 * the build runs, which is the point: the tests assert the strings the extension actually
 * ships, not a second copy of them that could drift.
 *
 * `getMessage` answers `''` for an unknown key, exactly as the browser does rather than
 * more helpfully — a typo'd key is caught by the generated types at compile time, so
 * there is nothing to gain here by being stricter than the platform.
 */
async function installI18n(): Promise<void> {
  const messages = generateChromeMessages(await parseMessagesFile('src/locales/en.yml'));

  const i18n = {
    getMessage: (key: string, substitutions?: string | string[]): string => {
      const message = messages[key]?.message;
      if (message === undefined) return '';
      const subs = substitutions === undefined ? [] : [substitutions].flat();
      return message.replace(/\$(\d)/g, (whole, digit: string) => subs[Number(digit) - 1] ?? whole);
    },
    getUILanguage: () => TEST_UI_LANGUAGE,
  };

  (fakeBrowser as unknown as { i18n: typeof i18n }).i18n = i18n;
}

await installI18n();

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
