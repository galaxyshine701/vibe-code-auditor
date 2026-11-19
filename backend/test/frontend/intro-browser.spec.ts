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
  };
}

const MEASURE = `(() => {
  const overlay = document.querySelector('.intro-overlay');
  const scene = document.querySelector('.intro-scene');
  const header = document.querySelector('.site-header');
  if (!overlay || !scene) return null;
  const o = overlay.getBoundingClientRect();
  const s = scene.getBoundingClientRect();
  const h = header.getBoundingClientRect();
  const hit = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2);
  const style = getComputedStyle(overlay);
  return {
    intro: document.documentElement.getAttribute('data-intro'),
    vw: innerWidth, vh: innerHeight,
    overlay: { top: o.top, left: o.left, width: o.width, height: o.height },
    position: style.position,
    z: Number(style.zIndex),
    headerZ: Number(getComputedStyle(header).zIndex),
    headerCovered: !!(hit && hit.closest('.intro-overlay')),
    scene: { x: s.left + s.width / 2, y: s.top + s.height / 2, top: s.top, bottom: s.bottom, left: s.left, right: s.right },
    scroll: getComputedStyle(document.documentElement).overflow,
  };
})()`;

describe.skipIf(!enabled)('the intro in a real Chrome', () => {
  it.each(SIZES)(
    'at %ix%i the overlay is the viewport, over the header, with the scene in the middle and nothing cut',
    async (width, height) => {
      const tab = await freshTab(width, height);
      await tab.open();
      // the first load of a new context must start the intro by itself
      let seen: any = null;
      for (let i = 0; i < 100 && !seen; i++) {
        const value = await tab.evaluate(MEASURE);
        if (value?.intro === 'pending') seen = value;
        else await sleep(50);
      }
      expect(seen, 'the intro did not start on the first load').not.toBeNull();
      await sleep(700); // still running: the intro ends at 2.6 s
      const m = (await tab.evaluate(MEASURE)) ?? seen;

      expect(m.intro).toBe('pending');
      expect(m.position).toBe('fixed');
      expect(m.overlay.top).toBe(0);
      expect(m.overlay.left).toBe(0);
      expect(m.overlay.width).toBe(m.vw);
      expect(m.overlay.height).toBe(m.vh);
      expect(m.z).toBeGreaterThan(m.headerZ);
      expect(m.headerCovered).toBe(true);
      expect(m.scroll).toBe('hidden');
      // the scene is in the middle of the viewport, within 2 % ...
      expect(Math.abs(m.scene.x - m.vw / 2)).toBeLessThanOrEqual(m.vw * 0.02);
      expect(Math.abs(m.scene.y - m.vh / 2)).toBeLessThanOrEqual(m.vh * 0.02);
      // ... and every part of it is inside
      expect(m.scene.top).toBeGreaterThanOrEqual(0);
      expect(m.scene.left).toBeGreaterThanOrEqual(0);
      expect(m.scene.bottom).toBeLessThanOrEqual(m.vh);
      expect(m.scene.right).toBeLessThanOrEqual(m.vw);

      // it ends by itself in 5 s, and a reload in the same tab does not repeat it
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
});
