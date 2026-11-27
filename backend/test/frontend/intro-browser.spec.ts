import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The intro measured in a real Chrome (R70). It needs a running frontend and a
// Chrome, so it runs only when `INTRO_E2E_URL` is set (for example
// `INTRO_E2E_URL=http://127.0.0.1:3199 npm test`, after `npm run build` and
// `npm start` in frontend/). It talks to Chrome over the DevTools protocol with
// Node's own WebSocket: no new package. Without the variable it is skipped.
const URL_UNDER_TEST = process.env.INTRO_E2E_URL;
const CHROME =
  process.env.CHROME_PATH ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path) => existsSync(path));
const enabled = Boolean(URL_UNDER_TEST && CHROME);

const SIZES: [number, number][] = [
  [1908, 874],
  [1366, 768],
  [375, 667],
];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  private id = 0;
  private waiting = new Map<number, (value: unknown) => void>();
  constructor(private socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      this.waiting.get(message.id)?.(message.result ?? message.error);
    });
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }
  send(method: string, params: object = {}, sessionId?: string) {
    const id = ++this.id;
    return new Promise<any>((resolve) => {
      this.waiting.set(id, resolve);
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close() {
    this.socket.close();
  }
}

let chrome: ChildProcess | undefined;
let profile = '';
let cdp: Cdp;

beforeAll(async () => {
  if (!enabled) return;
  profile = mkdtempSync(join(tmpdir(), 'vca-intro-'));
  chrome = spawn(CHROME!, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    'about:blank',
  ]);
  const wsUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Chrome did not start')),
      15000,
    );
    chrome!.stderr!.on('data', (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  cdp = await Cdp.connect(wsUrl);
}, 30000);

afterAll(() => {
  cdp?.close();
  chrome?.kill();
  if (profile) {
    // Chrome may still hold files for a moment (Windows): the folder is only a temp folder
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* left in the temp folder */
    }
  }
});

/** A new tab in a new browser context, like a fresh Incognito window: empty sessionStorage. */
async function freshTab(width: number, height: number) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const evaluate = async (expression: string) => {
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      sessionId,
    );
    return result.result?.value;
  };
  return {
    open: () => cdp.send('Page.navigate', { url: URL_UNDER_TEST! }, sessionId),
    reload: () => cdp.send('Page.reload', {}, sessionId),
    evaluate,
    send: (method: string, params: object = {}) =>
      cdp.send(method, params, sessionId),
  };
}

const MEASURE = `(() => {
  const overlay = document.querySelector('.intro-overlay');
  const visual = document.querySelector('.hero-visual');
  const header = document.querySelector('.site-header');
  if (!overlay || !visual) return null;
  const o = overlay.getBoundingClientRect();
  const v = visual.getBoundingClientRect();
  const style = getComputedStyle(overlay);
  const overlaps = (q) => [...document.querySelectorAll(q)].some((e) => {
    const r = e.getBoundingClientRect();
    return Math.min(r.right, o.right) - Math.max(r.left, o.left) > 1 && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > 1;
  });
  return {
    intro: document.documentElement.getAttribute('data-intro'),
    overlay: { top: o.top, left: o.left, width: o.width, height: o.height },
    visual: { top: v.top, left: v.left, width: v.width, height: v.height },
    position: style.position,
    pointer: style.pointerEvents,
    z: Number(style.zIndex),
    headerZ: Number(getComputedStyle(header).zIndex),
    overlapsWords: overlaps('.hero-title, .hero-problem, .start-box'),
    scroll: getComputedStyle(document.documentElement).overflow,
  };
})()`;

describe.skipIf(!enabled)('the intro in a real Chrome', () => {
  it.each(SIZES)(
    'at %ix%i the intro is over the picture only: the headline and the form are free',
    async (width, height) => {
      const tab = await freshTab(width, height);
      await tab.open();
      // the first load of a new context must start the intro by itself
      let m: any = null;
      for (let i = 0; i < 100 && !m; i++) {
        const value = await tab.evaluate(MEASURE);
        if (value?.intro === 'pending') m = value;
        else await sleep(20);
      }
      expect(m, 'the intro did not start on the first load').not.toBeNull();

      expect(m.position).toBe('absolute');
      expect(m.pointer).toBe('none');
      expect(Math.abs(m.overlay.top - m.visual.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.overlay.width - m.visual.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.overlay.height - m.visual.height)).toBeLessThanOrEqual(1);
      expect(m.z).toBeLessThan(m.headerZ);
      // nothing lies over the headline or the input, and the page can scroll
      expect(m.overlapsWords).toBe(false);
      expect(m.scroll).not.toBe('hidden');

      // it ends by itself, and a reload in the same tab does not repeat it
      let done = false;
      for (let i = 0; i < 80 && !done; i++) {
        done =
          (await tab.evaluate(
            "document.documentElement.getAttribute('data-intro')",
          )) === 'done';
        if (!done) await sleep(50);
      }
      expect(done).toBe(true);
      await tab.reload();
      await sleep(500);
      expect(
        await tab.evaluate(
          "document.documentElement.getAttribute('data-intro')",
        ),
      ).toBeNull();
    },
    30000,
  );

  const STATE = "document.documentElement.getAttribute('data-intro')";

  async function waitFor(
    tab: { evaluate: (e: string) => Promise<any> },
    expected: string | null,
    ms: number,
  ) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if ((await tab.evaluate(STATE)) === expected) return Date.now() - start;
      await sleep(30);
    }
    return -1;
  }

  it('a click on the page ends it and still does its own work', async () => {
    const tab = await freshTab(1366, 768);
    await tab.open();
    expect(await waitFor(tab, 'pending', 5000)).toBeGreaterThanOrEqual(0);
    const point = await tab.evaluate("(() => { const r = document.querySelector('.start-box input').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; })()");
    const [x, y] = point;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await tab.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    expect(await tab.evaluate("!!document.activeElement.closest('.start-box')")).toBe(true);
    expect(await waitFor(tab, 'done', 1500)).toBeGreaterThanOrEqual(0);
  }, 20000);

  it('the Skip button ends the scene at once (a fade, then done), before its own end', async () => {
    const tab = await freshTab(1366, 768);
    await tab.open();
    expect(
      await waitFor(tab, 'pending', 5000),
      'pending',
    ).toBeGreaterThanOrEqual(0);
    await sleep(100);
    await tab.evaluate("document.querySelector('.intro-skip')?.click()");
    const took = await waitFor(tab, 'done', 2000);
    expect(
      took,
      'done after skip: ' + (await tab.evaluate(STATE)),
    ).toBeGreaterThanOrEqual(0);
    expect(took).toBeLessThan(1000);
    // the page is there: the overlay is not shown and the scroll is free
    expect(
      await tab.evaluate(
        "(() => { const o = document.querySelector('.intro-overlay'); return (!o || getComputedStyle(o).display === 'none') && getComputedStyle(document.documentElement).overflow !== 'hidden'; })()",
      ),
    ).toBe(true);
  }, 20000);

  it('the scene runs about 1 s and the gate opens by itself (the state goes pending, opening, done)', async () => {
    const tab = await freshTab(1366, 768);
    // once to fill the cache: on a first load that is slow, the 1 s limit of the
    // head script can end the intro before the gate would open
    await tab.open();
    await sleep(2500);
    await tab.evaluate('sessionStorage.clear()');
    await tab.reload();
    expect(await waitFor(tab, 'pending', 5000)).toBeGreaterThanOrEqual(0);
    // the beam, the callouts and the name are in the picture
    expect(
      await tab.evaluate(
        "!!document.querySelector('.scan-beam') && document.querySelectorAll('.intro-callout').length >= 3",
      ),
    ).toBe(true);
    expect(await waitFor(tab, 'opening', 8000)).toBeGreaterThanOrEqual(0);
    expect(await waitFor(tab, 'done', 4000)).toBeGreaterThanOrEqual(0);
    // on the screen for about 1 s or less, counted from the first paint
    const shown = await tab.evaluate(
      "performance.now() - performance.getEntriesByType('paint')[0].startTime",
    );
    expect(shown).toBeLessThan(1500);
  }, 20000);

  it('with reduced motion there is no intro', async () => {
    const tab = await freshTab(375, 667);
    await tab.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await tab.open();
    await sleep(800);
    expect(await tab.evaluate(STATE)).toBeNull();
    expect(
      await tab.evaluate(
        "(() => { const o = document.querySelector('.intro-overlay'); return !o || getComputedStyle(o).display === 'none'; })()",
      ),
    ).toBe(true);
  }, 20000);

  const REPLAY = "document.querySelector('.hero-replay')";

  it.each([1366, 375])(
    'at %i px "Replay intro" plays the intro again, and it ends by itself',
    async (width) => {
      const tab = await freshTab(width, 768);
      await tab.open();
      expect(await waitFor(tab, 'done', 9000)).toBeGreaterThanOrEqual(0);
      await sleep(600); // the page's own code is there
      expect(await tab.evaluate(`getComputedStyle(${REPLAY}).display`)).not.toBe('none');
      await tab.evaluate(`${REPLAY}.click()`);
      expect(await waitFor(tab, 'pending', 1000)).toBeGreaterThanOrEqual(0);
      await sleep(100);
      expect(
        await tab.evaluate("getComputedStyle(document.querySelector('.intro-overlay')).display"),
      ).toBe('grid');
      const took = await waitFor(tab, 'done', 4000);
      expect(took).toBeGreaterThanOrEqual(0);
      expect(took + 100).toBeLessThan(1500);
      expect(await tab.evaluate("!!document.querySelector('.intro-overlay')")).toBe(false);
    },
    30000,
  );

  it('with reduced motion there is no replay button', async () => {
    const tab = await freshTab(1366, 768);
    await tab.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await tab.open();
    await sleep(1500);
    expect(await tab.evaluate(`getComputedStyle(${REPLAY}).display`)).toBe('none');
  }, 20000);

  it('the replay button and the theme button follow the language', async () => {
    const tab = await freshTab(1366, 768);
    await tab.open();
    expect(await waitFor(tab, 'done', 9000)).toBeGreaterThanOrEqual(0);
    await sleep(2000);
    const WORDS = `[${REPLAY}.textContent.trim(), document.querySelector('.theme-toggle').textContent.trim()]`;
    expect(await tab.evaluate(WORDS)).toEqual(['Replay intro', 'Light']);
    await tab.evaluate(
      "[...document.querySelectorAll('.hero-copy-top button')].find((b) => /urdu/i.test(b.textContent)).click()",
    );
    await sleep(300);
    expect(await tab.evaluate(WORDS)).toEqual(['Intro dobara chalayein', 'Roshan']);
  }, 30000);
});
