/*
 * Drives the *built* settings page in a real Chrome and checks three things a real
 * browser is the only judge of: that changing a field actually reaches storage, that the
 * page still opens in the browser's dialog rather than a tab, and that the form fits that
 * dialog in every language shipped.
 *
 * Why this exists on top of the unit tests: the bug that shipped was a value the type
 * checker accepted, the test double accepted, and only a real browser refused — reactive
 * state is a proxy, and `browser.storage` structured-clones what it is given. Tests now
 * model that (src/test-setup.ts), but a fake enforcing a rule is still a claim about the
 * browser; this checks the claim against one.
 *
 * chrome.storage is the only thing replaced, by a double that clones exactly like the
 * real one. Everything else is the shipped bundle.
 *
 *   pnpm build && node scripts/smoke-options.mjs
 *
 * Needs Google Chrome installed. Exits non-zero if a save does not land.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launch, serve, sleep } from './chrome.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, '.output/chrome-mv3');
const CDP_PORT = 9333;
const HTTP_PORT = 8912;

/**
 * The catalogues the build just produced, read from the bundle rather than from the YAML:
 * what the browser would load is what gets served here, so a string that never made it
 * through the build fails this the way it would fail a user.
 *
 * Every language shipped, not only English, because the two checks that use them are about
 * what the words do to the page — one looks for a key that renders as nothing, the other
 * for a page grown taller than the dialog — and English is the shortest of the three by
 * some 20px. A translation is where either would show up first.
 */
const LOCALES = (await readdir(join(DIST, '_locales'))).sort();
const CATALOGUES = Object.fromEntries(
  await Promise.all(
    LOCALES.map(async (locale) => [
      locale,
      JSON.parse(await readFile(join(DIST, `_locales/${locale}/messages.json`), 'utf8')),
    ]),
  ),
);

/**
 * What `i18n.getUILanguage()` answers for each. The settings page formats no dates or
 * numbers, so nothing here depends on it; it is set anyway so the double does not tell the
 * page it is English while handing it Catalan.
 */
const uiLanguage = (locale) => (locale === 'en' ? 'en-GB' : locale);

/**
 * The room the settings page gets. Chrome shows an options page without `open_in_tab` in
 * an embedded dialog whose height is `min(0.9 * window height, 640)` — and that 640
 * includes the dialog's own title bar, which is around 70px, so the page itself has some
 * 570 to work with. Past that it scrolls inside a frame that does not look scrollable,
 * which is how a whole section goes missing.
 *
 * The width is not a constraint: the page caps itself at 26rem, well under the dialog's
 * 400px floor plus what it grows to, so it is measured wide enough not to interfere. The
 * viewport is deliberately taller than the budget — the page has to be free to be too
 * tall, or the measurement below could not see it.
 */
const DIALOG = { maxHeight: 570 };
const VIEWPORT = { width: 800, height: 1200 };

/**
 * This page opens in that dialog, not in a tab.
 *
 * Checked against the built manifest because the config cannot be trusted to say: WXT
 * assembles `options_ui` from the entrypoint and assigns the whole object, so the same
 * key set in `wxt.config.ts` reads as deliberate, changes nothing, and quietly leaves the
 * default. 1.2.0 shipped opening in the dialog while the config said tab.
 */
const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));
if (manifest.options_ui?.open_in_tab === true) {
  throw new Error('options_ui.open_in_tab is true: settings would take over a tab');
}

/** chrome.storage, cloning like the browser does — the constraint the bug broke. */
const storageDouble = (seedJson, locale) => `(() => {
  const store = ${seedJson};
  const listeners = [];
  const local = {
    get: (keys) => new Promise((ok) => {
      const names = keys == null ? Object.keys(store)
        : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const k of names) if (k in store) out[k] = structuredClone(store[k]);
      ok(out);
    }),
    set: (items) => new Promise((ok, fail) => {
      try {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: store[k], newValue: structuredClone(v) };
          store[k] = structuredClone(v);
        }
        listeners.forEach((fn) => fn(changes, 'local'));
        ok();
      } catch (e) { window.__writeError = String(e); fail(e); }
    }),
    remove: () => Promise.resolve(),
    onChanged: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
  };
  // Every extension page has i18n, so the page is entitled to assume it: without one the
  // settings form throws on its first heading and renders nothing at all.
  const messages = ${JSON.stringify(CATALOGUES[locale])};
  const i18n = {
    getMessage: (key, subs) => {
      const message = messages[key]?.message;
      if (message === undefined) return '';
      const list = subs === undefined ? [] : [subs].flat().map(String);
      return message.replace(/\\$(\\d)/g, (whole, d) => list[Number(d) - 1] ?? whole);
    },
    getUILanguage: () => ${JSON.stringify(uiLanguage(locale))},
  };
  const api = {
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn), removeListener: () => {} } },
    runtime: { id: 'smoke', getURL: (p) => p, onMessage: { addListener: () => {} },
               sendMessage: () => Promise.resolve(undefined) },
    i18n,
  };
  window.chrome = api; window.browser = api;
  window.__dump = () => JSON.stringify(store);
})();`;

const server = await serve({ dist: DIST, port: HTTP_PORT });
const browser = await launch({ port: CDP_PORT });

/** The settings page, seeded and in one language. The viewport is fixed so the height
 * measured below does not depend on the window Chrome happened to open with. */
const openSettings = (seedJson, locale = 'en') =>
  browser.open(`http://127.0.0.1:${HTTP_PORT}/options.html`, {
    stub: storageDouble(seedJson, locale),
    viewport: VIEWPORT,
  });

const FIELDS = `[...document.querySelectorAll('input[type=number]')].map(i => i.value)`;
/** In DOM order: bullet, blitz, rapid, gap, losses. */
const INDEX = { bullet: 0, blitz: 1, rapid: 2, gap: 3, losses: 4 };

let failures = 0;
try {
  // Two things the words themselves decide, so the page is opened once per language
  // before anything is done to it.
  //
  // Every visible word now comes from the catalogue, and a key that is missing there
  // renders as an empty string rather than as an error: the form would still work, still
  // save, and still pass every check below while showing four blank headings.
  //
  // And the whole form has to fit the dialog. That is measured on the real bundle in a
  // real engine because the thing that decides it is the rendered text: a hint that wraps
  // onto one more line pushes the last section out of sight, and nothing in the CSS would
  // look wrong. English alone would not catch it — it is the shortest catalogue shipped.
  for (const locale of LOCALES) {
    const page = await openSettings('{}', locale);
    const labels = await page.eval(
      `JSON.stringify([...document.querySelectorAll('h2, label span')].map((e) => e.textContent.trim()))`,
    );
    // The form's own bottom edge, not the document's: the viewport is taller than the page
    // on purpose, so `documentElement.scrollHeight` would just report the viewport back.
    const height = await page.eval(
      `Math.ceil(document.querySelector('main').getBoundingClientRect().bottom)`,
    );
    page.close();

    const blank = JSON.parse(labels ?? '[]').filter((text) => text === '');
    if (blank.length > 0) throw new Error(`${locale}: ${blank.length} label(s) rendered empty`);
    if (height > DIALOG.maxHeight) {
      throw new Error(
        `${locale}: the settings page is ${height}px tall, and the dialog gives it about ${DIALOG.maxHeight}`,
      );
    }
    console.log(`ok    ${locale.padEnd(7)} ${height}px de ${DIALOG.maxHeight}`);
  }

  for (const [name, index] of Object.entries(INDEX)) {
    let page = await openSettings('{}');
    const before = await page.eval(FIELDS);
    if (before.length === 0) throw new Error('the settings page rendered no fields');

    const wanted = String(Number(before[index] || 0) + 2);
    await page.eval(`(() => {
      const input = document.querySelectorAll('input[type=number]')[${index}];
      input.value = ${JSON.stringify(wanted)};
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(1600);

    const writeError = await page.eval(`window.__writeError ?? null`);
    const dumped = await page.eval(`window.__dump()`);
    page.close();

    // Reopen seeded with what was stored: what a reload would show.
    page = await openSettings(dumped);
    const after = await page.eval(FIELDS);
    page.close();

    const ok = after[index] === wanted && writeError === null;
    if (!ok) failures++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(7)} ${before[index]} -> ${wanted}` +
        `  (tras recargar: ${after[index]})${writeError ? `  ${writeError}` : ''}`,
    );
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? '\nTodos los campos guardan.' : `\n${failures} campo(s) no guardan.`);
process.exit(failures === 0 ? 0 : 1);
