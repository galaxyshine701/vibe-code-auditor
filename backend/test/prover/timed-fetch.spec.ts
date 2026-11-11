import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SupabaseGateway } from '../../src/prover/gateway.js';
import {
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  timedFetch,
  toPlainError,
} from '../../src/prover/timed-fetch.js';

const PLAIN = 'Supabase did not answer in time.';
const SECRET = 'SECRET-KEY-VALUE-1a2b3c';

/** A fetch that never answers and ignores the abort signal (worst case). */
const neverResolves = (() => new Promise<Response>(() => {})) as typeof fetch;

describe('timedFetch', () => {
  it('uses a 20 second default, from one constant', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  it('fails with the plain error when the fetch never resolves (50 ms limit)', async () => {
    const started = Date.now();
    const error = await timedFetch(
      50,
      neverResolves,
    )(`https://x.supabase.co/?apikey=${SECRET}`).catch((e) => e);
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error.message).toBe(PLAIN);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('puts no URL and no key in the error', async () => {
    const error = await timedFetch(20, neverResolves)(
      `https://x.supabase.co/?apikey=${SECRET}`,
      { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } },
    ).catch((e) => e);
    const text = `${error.name} ${error.message} ${error.stack}`;
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('supabase.co');
  });

  it('aborts the real request when the time is up', async () => {
    let seen: AbortSignal | undefined;
    const honest = ((_input: unknown, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    }) as typeof fetch;
    const error = await timedFetch(30, honest)('https://x').catch((e) => e);
    expect(error.message).toBe(PLAIN); // not "AbortError"
    expect(seen?.aborted).toBe(true);
  });

  it('passes a fast answer through untouched', async () => {
    const fast = (() =>
      Promise.resolve(new Response('{"ok":true}'))) as typeof fetch;
    const res = await timedFetch(50, fast)('https://x');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('gives every request its own timer (no shared signal)', async () => {
    const signals: AbortSignal[] = [];
    let call = 0;
    const base = ((_input: unknown, init?: RequestInit) => {
      signals.push(init!.signal!);
      call += 1;
      return call === 1
        ? new Promise<Response>(() => {}) // the first one hangs
        : Promise.resolve(new Response('fine'));
    }) as typeof fetch;
    const fetchWithTimer = timedFetch(30, base);

    await fetchWithTimer('https://x').catch(() => {});
    // the first request timed out, but the second one starts clean
    const second = await fetchWithTimer('https://x');
    expect(await second.text()).toBe('fine');
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('also stops a response body that stalls after the headers came', async () => {
    const stalls = ((_input: unknown, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('aborted', 'AbortError')),
          );
        },
      });
      return Promise.resolve(new Response(body));
    }) as typeof fetch;
    const res = await timedFetch(40, stalls)('https://x');
    const error = await res.text().catch((e) => toPlainError(e));
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error.message).toBe(PLAIN);
  });
});

describe('SupabaseGateway against a server that never answers', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      // only the table list answers; everything else hangs forever
      if (req.url === '/rest/v1/') {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"definitions":{}}');
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const gateway = () =>
    new SupabaseGateway(
      { supabaseUrl: url, publishableKey: 'pub-key-123456', secretKey: SECRET },
      80,
    );

  it.each([
    ['a row count (supabase-js)', (g: SupabaseGateway) => g.countRows('t')],
    [
      'creating a user (supabase-js auth)',
      (g: SupabaseGateway) => g.createUser('a@example.com', 'pw'),
    ],
    [
      'looking up a user by email (supabase-js auth)',
      (g: SupabaseGateway) => g.deleteUserByEmail('a@example.com'),
    ],
    [
      'a REST call (direct fetch)',
      (g: SupabaseGateway) => g.restCall('GET', 't', null, { kind: 'anon' }),
    ],
  ])('times out %s with a plain message and no key', async (_what, call) => {
    const error = await call(gateway()).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('did not answer in time');
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).message).not.toContain('127.0.0.1');
  });

  it('a slow request does not block the next one on the same gateway', async () => {
    const g = gateway();
    await g.countRows('t').catch(() => {});
    // the table list answers, so this must succeed right after the timeout
    expect(await g.fetchOpenApi()).toEqual({ definitions: {} });
  });
});
