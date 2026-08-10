/*
 * Drives the *built* settings page in a real Chrome and checks that changing a field
 * actually reaches storage.
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
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, '.output/chrome-mv3');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9333;
const HTTP_PORT = 8912;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = async (path) => (await fetch(`http://127.0.0.1:${CDP_PORT}${path}`)).json();

/** Serves the built extension so the page loads over http, not file://. */
function serve() {
  const server = createServer(async (req, res) => {
    try {
      const body = await readFile(join(DIST, new URL(req.url, 'http://x').pathname));
      res.writeHead(200, { 'content-type': TYPES[extname(req.url.split('?')[0])] ?? 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(HTTP_PORT, '127.0.0.1', () => ok(server)));
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      const resolvePending = this.pending.get(m.id);
      if (resolvePending) {
        this.pending.delete(m.id);
        resolvePending(m);
      }
    });
  }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', fail, { once: true });
    });
    return new Page(ws);
  }
  send(method, params = {}) {
    return new Promise((ok) => {
      const n = ++this.id;
      this.pending.set(n, ok);
      this.ws.send(JSON.stringify({ id: n, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const failed = r.result?.exceptionDetails?.exception?.description;
    if (failed) throw new Error(failed.split('\n')[0]);
    return r.result?.result?.value;
  }
}

/** chrome.storage, cloning like the browser does — the constraint the bug broke. */
const storageDouble = (seedJson) => `(() => {
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
  const api = {
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn), removeListener: () => {} } },
    runtime: { id: 'smoke', getURL: (p) => p, onMessage: { addListener: () => {} },
               sendMessage: () => Promise.resolve(undefined) },
  };
  window.chrome = api; window.browser = api;
  window.__dump = () => JSON.stringify(store);
})();`;

async function openSettings(seedJson) {
  const browser = await Page.open((await cdp('/json/version')).webSocketDebuggerUrl);
  const { result } = await browser.send('Target.createTarget', { url: 'about:blank' });
  browser.ws.close();

  let ws = null;
  for (let i = 0; i < 40 && ws === null; i++) {
    const found = (await cdp('/json/list')).find((t) => t.id === result.targetId);
    if (found?.webSocketDebuggerUrl) ws = found.webSocketDebuggerUrl;
    else await sleep(200);
  }
  const page = await Page.open(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: storageDouble(seedJson) });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/options.html` });
  await sleep(2500);
  return page;
}

const FIELDS = `[...document.querySelectorAll('input[type=number]')].map(i => i.value)`;
/** In DOM order: bullet, blitz, rapid, gap, losses. */
const INDEX = { bullet: 0, blitz: 1, rapid: 2, gap: 3, losses: 4 };

const server = await serve();
const profile = await mkdtemp(join(tmpdir(), 'tilt-smoke-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
]);

let failures = 0;
try {
  for (let i = 0; i < 40; i++) {
    try {
      await cdp('/json/version');
      break;
    } catch {
      await sleep(250);
    }
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
    page.ws.close();

    // Reopen seeded with what was stored: what a reload would show.
    page = await openSettings(dumped);
    const after = await page.eval(FIELDS);
    page.ws.close();

    const ok = after[index] === wanted && writeError === null;
    if (!ok) failures++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(7)} ${before[index]} -> ${wanted}` +
        `  (tras recargar: ${after[index]})${writeError ? `  ${writeError}` : ''}`,
    );
  }
} finally {
  chrome.kill();
  // Wait for it to actually go: it is still writing to the profile until it does.
  await Promise.race([new Promise((ok) => chrome.once('exit', ok)), sleep(5000)]);
  server.close();
  // Best effort. A leftover directory in tmp is not worth failing the check over.
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\nTodos los campos guardan.' : `\n${failures} campo(s) no guardan.`);
process.exit(failures === 0 ? 0 : 1);
