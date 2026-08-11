/*
 * Driving a real Chrome, for the two checks that need one.
 *
 * `smoke-options.mjs` and `make-screenshots.mjs` both load the *built* bundle in a real
 * engine — one to prove the settings page still saves and still fits, the other to render
 * what the store listing shows. That is the same eighty lines of plumbing twice, and two
 * copies is how they drift: the day one of them starts stubbing `browser.i18n` differently
 * is the day the screenshots stop being evidence about the thing the smoke check passed.
 *
 * So the plumbing lives here and the doubles do not. What to pretend the browser is —
 * storage, i18n, what the background answers — is exactly what each of them is about, and
 * that stays where it can be read next to the thing it serves.
 *
 * Needs Google Chrome installed. Nothing here talks to the network.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Serves the built extension, so its pages load over http rather than `file://` — where
 * they would each be their own origin and an iframe could not be read at all.
 *
 * `pages` holds html written by the caller and served from the same origin as the bundle;
 * `files` maps a request path to a file outside it. Both exist for the screenshots, which
 * frame the real pages in a canvas of their own.
 */
export function serve({ dist, port, pages = new Map(), files = new Map() }) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://x').pathname;
    if (pages.has(path)) {
      response.writeHead(200, { 'content-type': 'text/html' });
      return response.end(pages.get(path));
    }
    try {
      const body = await readFile(files.get(path) ?? join(dist, path));
      response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/plain' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

/** One tab, and the few commands we send it. */
export class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const resolvePending = this.pending.get(message.id);
      if (resolvePending) {
        this.pending.delete(message.id);
        resolvePending(message);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', fail, { once: true });
    });
    return new Page(ws);
  }

  send(method, params = {}) {
    return new Promise((ok) => {
      const id = ++this.id;
      this.pending.set(id, ok);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Whatever the expression evaluates to, or a throw carrying what the page threw. */
  async eval(expression) {
    const answer = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const failed = answer.result?.exceptionDetails?.exception?.description;
    if (failed) throw new Error(failed.split('\n')[0]);
    return answer.result?.result?.value;
  }

  close() {
    this.ws.close();
  }
}

/**
 * A headless Chrome on a throwaway profile.
 *
 * `close()` waits for it to actually exit before removing that profile: it is still
 * writing to it until then, and deleting underneath it leaves the process complaining
 * about a directory that is no longer there.
 */
export async function launch({ port, args = [] }) {
  const profile = await mkdtemp(join(tmpdir(), 'tilt-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...args,
    'about:blank',
  ]);

  const cdp = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();

  // It answers when it is ready and not before, so this is the wait for startup.
  let started = false;
  for (let i = 0; i < 40 && !started; i++) {
    try {
      await cdp('/json/version');
      started = true;
    } catch {
      await sleep(250);
    }
  }
  if (!started) throw new Error(`Chrome did not answer on port ${port}`);

  return {
    cdp,

    /**
     * A new tab showing `url`.
     *
     * `stub` is evaluated before anything the document loads, which is the only moment
     * that works: these pages read `browser.*` as they start, and a double installed after
     * navigation arrives after the page has already given up.
     *
     * `settleMs` is a wait, not a signal. These pages have no "ready" of their own to
     * listen for — they render from storage, an answer from the background and a web font,
     * and the check that follows is about what is on screen once all three have landed.
     */
    async open(url, { stub, viewport, timezone, settleMs = 2500 } = {}) {
      const browser = await Page.connect((await cdp('/json/version')).webSocketDebuggerUrl);
      const { result } = await browser.send('Target.createTarget', { url: 'about:blank' });
      browser.close();

      let target = null;
      for (let i = 0; i < 40 && target === null; i++) {
        const found = (await cdp('/json/list')).find((tab) => tab.id === result.targetId);
        if (found?.webSocketDebuggerUrl) target = found.webSocketDebuggerUrl;
        else await sleep(200);
      }
      if (target === null) throw new Error('Chrome opened no tab to drive');

      const page = await Page.connect(target);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      if (viewport !== undefined) {
        await page.send('Emulation.setDeviceMetricsOverride', {
          ...viewport,
          deviceScaleFactor: 1,
          mobile: false,
        });
      }
      if (timezone !== undefined) {
        await page.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
      }
      if (stub !== undefined) {
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
      }
      await page.send('Page.navigate', { url });
      await sleep(settleMs);
      return page;
    },

    async close() {
      chrome.kill();
      await Promise.race([new Promise((ok) => chrome.once('exit', ok)), sleep(5000)]);
      // Best effort. A leftover directory in tmp is not worth failing a check over.
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
