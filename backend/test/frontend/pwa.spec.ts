import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Checks the PWA files of the frontend: the service worker (public/sw.js), the
// manifest, the icons and the offline page. The frontend has no test runner of
// its own (see progress.spec.ts), so they run here. The worker is run inside a
// fake "self" with a fake cache, so nothing needs a browser.
const FRONTEND = join(process.cwd(), '..', 'frontend');
const ORIGIN = 'https://app.example.test';

const workerSource = readFileSync(join(FRONTEND, 'public', 'sw.js'), 'utf-8');

interface FakeEvent {
  request?: FakeRequest;
  waitUntil(promise: Promise<unknown>): void;
  respondWith(promise: Promise<unknown>): void;
  waited?: Promise<unknown>;
  responded?: Promise<unknown>;
}

class FakeRequest {
  constructor(
    public url: string,
    public init: Record<string, unknown> & {
      mode?: string;
      method?: string;
    } = {},
  ) {}
  get mode() {
    return this.init.mode ?? 'cors';
  }
  get method() {
    return this.init.method ?? 'GET';
  }
}

const marker = (name: string) => ({ marker: name });

/** The worker, loaded with a fake self, fake caches and a fake fetch. */
function loadWorker(
  fetchImpl: (request: FakeRequest) => Promise<unknown> = async () =>
    marker('network'),
  existingCaches: Record<string, boolean> = {},
) {
  const listeners: Record<string, (event: FakeEvent) => void> = {};
  const opened: string[] = [];
  const added: FakeRequest[] = [];
  const stored = new Map<string, unknown>();
  const names = new Set(Object.keys(existingCaches));
  const deleted: string[] = [];
  const forbidden = vi.fn(() => {
    throw new Error('this must never be called');
  });

  const cache = {
    add: async (request: FakeRequest) => {
      added.push(request);
      stored.set(new URL(request.url, ORIGIN).pathname, marker('offline-page'));
    },
    match: async (url: string) => stored.get(url),
    put: forbidden,
    addAll: forbidden,
  };
  const fakeCaches = {
    open: async (name: string) => {
      opened.push(name);
      names.add(name);
      return cache;
    },
    keys: async () => [...names],
    delete: async (name: string) => {
      deleted.push(name);
      names.delete(name);
      return true;
    },
  };
  const fakeSelf = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: FakeEvent) => void) => {
      listeners[type] = listener;
    },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  class FakeResponse {
    static error() {
      return marker('error');
    }
  }

  new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'Response',
    'URL',
    workerSource,
  )(fakeSelf, fakeCaches, fetchImpl, FakeRequest, FakeResponse, URL);

  const dispatch = async (type: string, request?: FakeRequest) => {
    const event: FakeEvent = {
      request,
      waitUntil(promise) {
        this.waited = promise;
      },
      respondWith(promise) {
        this.responded = promise;
      },
    };
    listeners[type](event);
    await event.waited;
    return event;
  };

  return {
    listeners,
    opened,
    added,
    stored,
    names,
    deleted,
    forbidden,
    fakeSelf,
    dispatch,
  };
}

const navigation = (path: string, over: Record<string, unknown> = {}) =>
  new FakeRequest(`${ORIGIN}${path}`, {
    mode: 'navigate',
    method: 'GET',
    ...over,
  });

describe('install and activate', () => {
  it('stores only /offline.html, in a versioned cache, and takes over at once', async () => {
    const worker = loadWorker();
    await worker.dispatch('install');
    expect(worker.opened).toEqual(['vca-offline-v1']);
    expect(worker.opened[0]).toMatch(/^vca-offline-v\d+$/);
    expect(worker.added).toHaveLength(1);
    expect(worker.added[0].url).toBe('/offline.html');
    // fetched fresh and without cookies
    expect(worker.added[0].init).toMatchObject({
      cache: 'reload',
      credentials: 'omit',
    });
    expect(worker.fakeSelf.skipWaiting).toHaveBeenCalledTimes(1);
    expect(worker.forbidden).not.toHaveBeenCalled();
  });

  it('deletes every older cache of its own kind, and nothing else', async () => {
    const worker = loadWorker(undefined, {
      'vca-offline-v0': true,
      'vca-offline-v1': true,
      'vca-offline-v9': true,
      'other-app-cache': true,
    });
    await worker.dispatch('activate');
    expect(worker.deleted.sort()).toEqual(['vca-offline-v0', 'vca-offline-v9']);
    expect(worker.names.has('vca-offline-v1')).toBe(true);
    expect(worker.names.has('other-app-cache')).toBe(true);
    expect(worker.fakeSelf.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe('what the worker does with a request', () => {
  it('shows the network page when the network works, and stores nothing', async () => {
    const worker = loadWorker(async () => marker('network-page'));
    await worker.dispatch('install');
    const event = await worker.dispatch(
      'fetch',
      navigation('/audits/aud_1/report'),
    );
    expect(await event.responded).toEqual(marker('network-page'));
    expect(worker.forbidden).not.toHaveBeenCalled();
    expect(worker.added).toHaveLength(1); // still only the offline page
  });

  it('shows /offline.html when the page cannot be loaded', async () => {
    const worker = loadWorker(async () => {
      throw new TypeError('network down');
    });
    await worker.dispatch('install');
    const event = await worker.dispatch('fetch', navigation('/'));
    expect(await event.responded).toEqual(marker('offline-page'));
  });

  it('answers with an error, not a crash, if the offline page is missing', async () => {
    const worker = loadWorker(async () => {
      throw new TypeError('network down');
    });
    const event = await worker.dispatch('fetch', navigation('/'));
    expect(await event.responded).toEqual(marker('error'));
  });

  it.each([
    ['the API of this site', navigation('/api/v1/audits')],
    ['the API root', navigation('/api')],
    [
      'a page of another address',
      new FakeRequest('https://other.test/somewhere', {
        mode: 'navigate',
      }),
    ],
    [
      'a script or a style',
      new FakeRequest(`${ORIGIN}/_next/static/app.js`, { mode: 'no-cors' }),
    ],
    [
      'a request of the page (fetch)',
      new FakeRequest(`${ORIGIN}/x`, { mode: 'cors' }),
    ],
    ['a navigation that is not GET', navigation('/', { method: 'POST' })],
    [
      'an image',
      new FakeRequest(`${ORIGIN}/icons/icon-192.png`, { mode: 'no-cors' }),
    ],
  ])('leaves %s to the browser (no respondWith)', async (_name, request) => {
    const fetchImpl = vi.fn(async () => marker('network'));
    const worker = loadWorker(fetchImpl);
    await worker.dispatch('install');
    const event = await worker.dispatch('fetch', request);
    expect(event.responded).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a request that carries the access code is never seen by the worker', async () => {
    const request = new FakeRequest('https://api.other.test/api/v1/audits', {
      mode: 'cors',
      headers: { 'x-access-code': 'SECRET-ACCESS-CODE' },
    });
    const worker = loadWorker();
    await worker.dispatch('install');
    const event = await worker.dispatch('fetch', request);
    expect(event.responded).toBeUndefined();
    expect(worker.forbidden).not.toHaveBeenCalled();
    expect(JSON.stringify([...worker.stored.values()])).not.toContain('SECRET');
  });
});

describe('the worker file', () => {
  const code = workerSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('never writes a network response into a cache', () => {
    expect(code).not.toMatch(/\.put\(/);
    expect(code).not.toMatch(/addAll/);
    expect(code).not.toMatch(/\.clone\(/);
  });

  it('does not precache the app (no scripts, styles or _next files)', () => {
    expect(code).not.toContain('_next');
    expect(code).not.toMatch(/\.(js|css)['"`]/);
  });

  it('has a versioned cache name and does not know the access code', () => {
    expect(code).toMatch(/const CACHE = 'vca-offline-v\d+';/);
    expect(code).not.toMatch(
      /access|authorization|x-access-code|apikey|cookie/i,
    );
  });
});

describe('the manifest', async () => {
  const module = (await import(
    /* @vite-ignore */ pathToFileURL(
      join(FRONTEND, 'src', 'app', 'manifest.ts'),
    ).href
  )) as {
    default: () => Record<string, unknown> & {
      icons: Record<string, string>[];
    };
  };
  const manifest = module.default();

  it('has the fields an installable app needs', () => {
    expect(manifest).toMatchObject({
      name: 'Gatecheck',
      short_name: 'Gatecheck',
      start_url: '/',
      display: 'standalone',
      background_color: '#0f1114',
      theme_color: '#0f1114',
    });
    expect(String(manifest.short_name).length).toBeLessThanOrEqual(12);
  });

  it('lists icons of 192 and 512, normal and maskable, and each file exists with that size', () => {
    const wanted = [
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['192x192', 'maskable'],
      ['512x512', 'maskable'],
    ];
    for (const [sizes, purpose] of wanted) {
      const icon = manifest.icons.find(
        (i) => i.sizes === sizes && i.purpose === purpose,
      );
      expect(icon, `${sizes} ${purpose}`).toBeDefined();
      expect(icon!.type).toBe('image/png');
      const file = readFileSync(join(FRONTEND, 'public', icon!.src));
      // PNG signature, then the width and height in the IHDR chunk
      expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const [w, h] = sizes.split('x').map(Number);
      expect(file.readUInt32BE(16)).toBe(w);
      expect(file.readUInt32BE(20)).toBe(h);
    }
  });
});

describe('the offline page', () => {
  const html = readFileSync(join(FRONTEND, 'public', 'offline.html'), 'utf-8');

  it('is one self-contained file: no script, no address, no web font', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).toContain('<style>');
  });

  it('says it is offline and offers a way back', () => {
    expect(html).toContain('You are offline.');
    expect(html).toContain('href="/"');
  });
});

describe('where the worker is registered', () => {
  const register = readFileSync(
    join(FRONTEND, 'src', 'components', 'sw-register.tsx'),
    'utf-8',
  );
  const config = readFileSync(join(FRONTEND, 'next.config.ts'), 'utf-8');

  it('only in a production build, with the browser checking the file on every visit', () => {
    expect(register).toContain("process.env.NODE_ENV !== 'production'");
    expect(register).toContain("register('/sw.js'");
    expect(register).toContain("updateViaCache: 'none'");
  });

  it('serves sw.js without caching, so a redeploy replaces an old worker', () => {
    expect(config).toContain("source: '/sw.js'");
    expect(config).toMatch(/no-cache, no-store, must-revalidate/);
  });
});
