/*
 * Renders the store screenshots from the *built* bundle.
 *
 *   pnpm screenshots
 *
 * Two of the three listing images are the extension's own surfaces, and neither can be
 * captured the ordinary way: a popup is not a page you can open, and the settings page
 * lives in a dialog the browser draws around it. So they were made by hand, and then went
 * stale without anyone noticing — the popup grew a record and a rating, the settings form
 * was rebuilt, and the store kept showing an interface that no longer existed. This is
 * that job written down, so redoing it before a submission costs one command.
 *
 * What it renders is the shipped bundle. Only the browser around it is faked: storage, the
 * catalogue, and the background's answer, all seeded below with a plausible evening.
 * `3-rematch-blocked.jpg` is not made here — it is the blocking overlay running on the
 * real site after a real game, and no seeded state can stand in for a game ending.
 *
 * Two captures of the live site are composited under the interface. The popup goes over
 * `store/backdrop-chesscom.jpg`, which has the 1.2.0 popup baked into it, so the new panel
 * has to cover the old one completely or the shot ships two popups; `LEGACY_PANEL` is that
 * old panel's box and the coverage is checked before anything is written. The blocking
 * screen goes over `store/backdrop-lobby.jpg`, a signed-out lobby captured with the ad slot
 * refused at the network — no account of anyone's in it, and no upsell for a listing image
 * to carry.
 *
 * Needs Google Chrome installed, and the network for the avatar — which is fetched from
 * chess.com's CDN exactly as the extension fetches it. It fails rather than quietly
 * writing a screenshot with the avatar missing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launch, serve, sleep } from './chrome.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, '.output/chrome-mv3');
const SHOTS = join(ROOT, 'store/screenshots');
const BACKDROP = join(ROOT, 'store/backdrop-chesscom.jpg');
const LOBBY = join(ROOT, 'store/backdrop-lobby.jpg');
const CDP_PORT = 9334;
const HTTP_PORT = 8913;

/** What the store dashboard wants, and what the backdrop was captured at. */
const CANVAS = { width: 1280, height: 800 };

/** The language the listing images are in. The store takes one set. */
const LOCALE = process.env.LOCALE ?? 'en';

/**
 * Where the popup hangs: right edge and top, in canvas pixels. It is drawn at its own
 * size — 22rem, the width a real popup opens at — rather than scaled to match the
 * backdrop, which was captured on a larger window and shrunk to 1280×800.
 */
const PANEL = { right: 1164, top: 4 };

/**
 * The 1.2.0 popup already in the backdrop, shadow included, measured from that image.
 * Anything the new panel does not cover here would show up as the ghost of an interface
 * two versions old, in the first screenshot of the listing.
 */
const LEGACY_PANEL = { left: 924, top: 4, right: 1156, bottom: 304 };

/** How tall the settings page is drawn, before scaling to fill the canvas. */
const SETTINGS_TARGET_HEIGHT = 700;

/**
 * The game type the blocking image is about, and where the lobby's "Start Game" sits in
 * `backdrop-lobby.jpg` — measured off that capture, so it moves only if the capture is
 * retaken.
 */
const BLOCKED_TYPE = 'rapid';
const START_GAME = { left: 827, top: 163, width: 222, height: 52 };

const messages = JSON.parse(await readFile(join(DIST, `_locales/${LOCALE}/messages.json`), 'utf8'));

/**
 * The evening the screenshots tell: blitz spent and gone red, bullet barely started,
 * rapid untouched, and a rating that has taken the day badly. Every tally adds up to the
 * count beside it, because the popup would be describing an impossible day otherwise.
 *
 * `gapUntil` is a fixed instant rather than "now plus a bit": these images are committed,
 * and a clock that reads differently on every run turns each rebuild into a diff.
 */
const GAP_UNTIL = Date.parse('2026-08-11T21:34:00+02:00');
const TIMEZONE = 'Europe/Madrid';

const VIEW = {
  gapUntil: GAP_UNTIL,
  rows: [
    {
      gameType: 'bullet',
      used: 2,
      limit: 8,
      tally: { wins: 1, draws: 0, losses: 1 },
      ratingDelta: -4,
      lossStreak: 1,
      decision: { allow: true },
    },
    {
      gameType: 'blitz',
      used: 6,
      limit: 6,
      tally: { wins: 2, draws: 1, losses: 3 },
      ratingDelta: -18,
      lossStreak: 2,
      decision: { allow: false, reason: 'quota', used: 6, limit: 6 },
    },
    {
      gameType: 'rapid',
      used: 1,
      limit: 3,
      tally: { wins: 1, draws: 0, losses: 0 },
      ratingDelta: 12,
      lossStreak: 0,
      decision: { allow: true },
    },
  ],
};

/**
 * What the background answers the content script, which is the whole of what the blocking
 * image needs: the quota for one game type is spent and the click that asks for another is
 * refused.
 *
 * Later in the same evening than the popup above, which still has a rapid game left in it.
 * A listing image is a moment, not a frame of the same second, and the alternative — a
 * popup already showing 3/3 — would cost the shot that shows a day mid-flight.
 */
const DECISIONS = {
  bullet: { allow: true },
  blitz: { allow: true },
  rapid: { allow: false, reason: 'quota', used: 3, limit: 3 },
};

/** The account both pages show, and the defaults the settings page is shipped with. */
const SEED = {
  detectedUsername: 'crabinloan',
  avatar:
    'https://images.chesscomfiles.com/uploads/v1/user/519936269.3685698e.200x200o.f9873ccc7cb4.png',
  // What the popup shows beside each game type's name. Under the account it is stored
  // for, because the popup checks the pair before showing a number — seeded to the wrong
  // name, the listing image would come out with three names and no ratings. `played` is
  // where a rating for a game type played today comes from, which is all three of these.
  ratings: {
    username: 'crabinloan',
    played: { bullet: 1204, blitz: 1187, rapid: 1455 },
    profile: {},
  },
  settings: {
    limits: { bullet: 8, blitz: 6, rapid: 3 },
    tilt: { losses: 3 },
    gapMinutes: 15,
    blockRematch: true,
  },
};

/**
 * The browser these pages assume. Storage answers from the seed, i18n from the catalogue
 * the build produced, and the background with the day above — the popup asks it for the
 * whole view in one message and renders nothing without an answer.
 */
const stub = `(() => {
  const store = ${JSON.stringify(SEED)};
  const local = {
    get: (keys) => new Promise((ok) => {
      const names = keys == null ? Object.keys(store)
        : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const k of names) if (k in store) out[k] = structuredClone(store[k]);
      ok(out);
    }),
    set: (items) => { Object.assign(store, structuredClone(items)); return Promise.resolve(); },
    remove: () => Promise.resolve(),
    onChanged: { addListener: () => {}, removeListener: () => {} },
  };
  const messages = ${JSON.stringify(messages)};
  const i18n = {
    getMessage: (key, subs) => {
      const message = messages[key]?.message;
      if (message === undefined) return '';
      const list = subs === undefined ? [] : [subs].flat().map(String);
      return message.replace(/\\$(\\d)/g, (whole, d) => list[Number(d) - 1] ?? whole);
    },
    getUILanguage: () => ${JSON.stringify(LOCALE === 'en' ? 'en-GB' : LOCALE)},
  };
  const api = {
    storage: { local, onChanged: { addListener: () => {}, removeListener: () => {} } },
    runtime: {
      id: 'screenshots',
      getURL: (path) => path,
      onMessage: { addListener: () => {} },
      openOptionsPage: () => {},
      sendMessage: () => Promise.resolve(
        {
          decisions: ${JSON.stringify(DECISIONS)},
          blockRematch: true,
          view: ${JSON.stringify(VIEW)},
        },
      ),
    },
    i18n,
  };
  window.chrome = api; window.browser = api;
})();`;

const panel = {
  left: PANEL.right - 352,
  top: PANEL.top,
  right: PANEL.right,
  // The popup's own height, filled in once it has rendered.
  bottom: 0,
};

/**
 * The popup over the site, at the size a popup actually opens at, with a shadow of its
 * own: the browser draws one around it, and without it the panel reads as part of the
 * page rather than as something sitting above it.
 */
const popupCanvas = `<!doctype html><meta charset="utf-8"><title>popup</title><style>
  html, body { margin: 0; width: ${CANVAS.width}px; height: ${CANVAS.height}px; overflow: hidden; }
  body { background: url(/backdrop.jpg) no-repeat 0 0 / ${CANVAS.width}px ${CANVAS.height}px; }
  .panel {
    position: absolute; top: ${PANEL.top}px; right: ${CANVAS.width - PANEL.right}px;
    width: 352px; border-radius: 8px; overflow: hidden;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.62), 0 2px 8px rgba(0, 0, 0, 0.5);
  }
  iframe { width: 352px; border: 0; display: block; }
</style>
<div class="panel"><iframe src="/popup.html"></iframe></div>
<script>
  // The popup is as tall as the day it is describing, so it is measured rather than
  // guessed: a fixed height would either clip a row or leave a strip of empty card.
  addEventListener('load', () => {
    const frame = document.querySelector('iframe');
    const height = Math.ceil(
      frame.contentDocument.querySelector('main').getBoundingClientRect().height,
    );
    frame.style.height = height + 'px';
    window.__panelHeight = height;
  });
</script>`;

/**
 * The settings page on the extension's own background, scaled to fill the canvas: at its
 * real size it is a small form adrift in 1280×800, which reads as an empty screenshot.
 */
const settingsCanvas = `<!doctype html><meta charset="utf-8"><title>settings</title><style>
  html, body { margin: 0; width: ${CANVAS.width}px; height: ${CANVAS.height}px; overflow: hidden; background: #262421; }
  .page { position: absolute; top: 50%; left: 50%; width: 416px; }
  iframe { width: 416px; border: 0; display: block; }
</style>
<div class="page"><iframe src="/options.html"></iframe></div>
<script>
  addEventListener('load', () => {
    const frame = document.querySelector('iframe');
    const page = frame.parentElement;
    const doc = frame.contentDocument;
    // Down to the last section, not to the end of the page: the toast row below it is
    // empty while nothing is being saved, and counting it hangs the form off the top.
    const padding = parseFloat(getComputedStyle(doc.querySelector('main')).paddingTop);
    const last = doc.querySelector('main > section:last-of-type');
    const height = Math.ceil(last.getBoundingClientRect().bottom + padding);
    const scale = ${SETTINGS_TARGET_HEIGHT} / height;
    frame.style.height = page.style.height = height + 'px';
    page.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  });
</script>`;

/**
 * The blocking screen, over the lobby it refuses you from.
 *
 * Nothing here draws the overlay: the built content script is loaded onto the page and
 * shown the answer the background would have given, and what it puts on screen is what it
 * puts on screen on chess.com. That is why the block is worth a listing image at all — it
 * is the one surface a user meets at the moment the extension does its job.
 *
 * The two elements below are stand-ins for the lobby's, because the lobby in the image is
 * a photograph and cannot be clicked: the selector holds the game type the way chess.com
 * holds it, in a `game-time-*` glyph, and "Start Game" sits transparent over the pixels
 * where the real one is, so the click that raises the overlay lands where the image shows
 * the button. Neither is ever visible; the overlay covers the viewport.
 */
const blockedCanvas = `<!doctype html><meta charset="utf-8"><title>blocked</title><style>
  html, body { margin: 0; width: ${CANVAS.width}px; height: ${CANVAS.height}px; overflow: hidden; }
  body { background: url(/lobby.jpg) no-repeat 0 0 / ${CANVAS.width}px ${CANVAS.height}px; }
  .selected { position: fixed; left: -9999px; top: 0; }
  .new-game-primary {
    position: fixed;
    left: ${START_GAME.left}px; top: ${START_GAME.top}px;
    width: ${START_GAME.width}px; height: ${START_GAME.height}px;
    opacity: 0;
  }
  .new-game-primary button { width: 100%; height: 100%; }
</style>
<div class="selected">
  <div class="time-selector-next-component"><svg data-glyph="game-time-${BLOCKED_TYPE}"></svg></div>
</div>
<div class="new-game-primary"><button type="button">Start Game</button></div>
<script src="/content-scripts/chesscom.js"></script>`;

const server = await serve({
  dist: DIST,
  port: HTTP_PORT,
  pages: new Map([
    ['/canvas/popup.html', popupCanvas],
    ['/canvas/settings.html', settingsCanvas],
    ['/canvas/blocked.html', blockedCanvas],
  ]),
  files: new Map([
    ['/backdrop.jpg', BACKDROP],
    ['/lobby.jpg', LOBBY],
  ]),
});
const browser = await launch({ port: CDP_PORT, args: ['--hide-scrollbars'] });

async function capture(page, name) {
  const shot = await page.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 92,
    clip: { x: 0, y: 0, ...CANVAS, scale: 1 },
    captureBeyondViewport: false,
  });
  const file = join(SHOTS, `${name}.jpg`);
  await writeFile(file, Buffer.from(shot.result.data, 'base64'));
  console.log(`ok    ${name}.jpg`);
}

try {
  const popup = await browser.open(`http://127.0.0.1:${HTTP_PORT}/canvas/popup.html`, {
    stub,
    viewport: CANVAS,
    timezone: TIMEZONE,
  });

  // The avatar comes from chess.com over the network, and the popup drops it silently
  // when it fails to load — which is right for a user and wrong for a store image, where
  // it would be a difference nobody would think to look for.
  const avatar = await popup.eval(
    `(() => {
      const image = document.querySelector('iframe').contentDocument.querySelector('header .account img');
      return image === null ? 'missing' : image.naturalWidth > 0 ? 'ok' : 'failed';
    })()`,
  );
  if (avatar !== 'ok') throw new Error(`the account avatar ${avatar}: is the network there?`);

  panel.bottom = panel.top + (await popup.eval(`window.__panelHeight ?? 0`));
  const covers =
    panel.left <= LEGACY_PANEL.left &&
    panel.top <= LEGACY_PANEL.top &&
    panel.right >= LEGACY_PANEL.right &&
    panel.bottom >= LEGACY_PANEL.bottom;
  if (!covers) {
    throw new Error(
      `the popup covers ${JSON.stringify(panel)}, which leaves the 1.2.0 one at ` +
        `${JSON.stringify(LEGACY_PANEL)} showing through`,
    );
  }

  await capture(popup, '1-popup');
  popup.close();

  const blocked = await browser.open(`http://127.0.0.1:${HTTP_PORT}/canvas/blocked.html`, {
    stub,
    viewport: CANVAS,
    timezone: TIMEZONE,
  });

  // The content script asks for the decisions on load and refuses nothing until they land.
  await sleep(1_500);

  // A mouse press rather than `element.click()`: the overlay takes focus as it opens, and
  // focus arriving any way other than by pointer draws a ring Chrome would never draw for
  // the click this stands in for — which would ship as a blue outline nobody could explain.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await blocked.send('Input.dispatchMouseEvent', {
      type,
      x: START_GAME.left + START_GAME.width / 2,
      y: START_GAME.top + START_GAME.height / 2,
      button: 'left',
      clickCount: 1,
    });
  }
  await sleep(600);

  // The overlay lives in a closed shadow root, so it cannot be read back to check. What
  // can be checked is that the click was refused: the extension logs every block, and a
  // page that reached chess.com's own handler would have navigated.
  const raised = await blocked.eval(`document.querySelectorAll('body > *').length`);
  if (raised < 4) throw new Error('the overlay did not open: is the seeded decision spent?');

  await capture(blocked, `2-quota-spent`);
  blocked.close();

  const settings = await browser.open(`http://127.0.0.1:${HTTP_PORT}/canvas/settings.html`, {
    stub,
    viewport: CANVAS,
    timezone: TIMEZONE,
  });
  await capture(settings, '4-settings');
  settings.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nEscritas en store/screenshots/, en ${LOCALE}.`);
