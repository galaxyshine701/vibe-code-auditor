import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  MIN_ACCESS_CODE_LENGTH,
  resolveAccessConfig,
  resolveTrustProxyHops,
} from '../../src/access/access-config.js';
import {
  ACCESS_CONFIG,
  safeEqual,
} from '../../src/access/access-code.guard.js';
import { AttemptLimiter } from '../../src/access/attempt-limiter.js';
import { clientKey } from '../../src/access/client-ip.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { GATEWAY_FACTORY } from '../../src/audits/audits.service.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';

// A made-up code that only exists in these tests. It is not a real code.
const CODE = 'TEST-ONLY-made-up-code-0123456789';
const PROJECT_URL = 'https://abcdefghijklmnopqrst.supabase.co';

const validBody = () => ({
  label: 'Access test',
  projectUrl: PROJECT_URL,
  anonKey: 'PUBLISHABLE-KEY-VALUE-9f8e7d',
  serviceKey: 'SECRET-KEY-VALUE-1a2b3c',
  confirmTestProject: true,
});

const tables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
];

async function buildApp(
  options: { env?: Record<string, string>; logs?: boolean } = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(() => new FakeGateway(tables()))
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'code', code: CODE })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(options.logs ? new ConsoleLogger() : false);
  configureApp(app, options.env ?? {});
  await app.init();
  return app;
}

/** GET of an unknown audit: a request that passes the guard answers 404. */
const probe = (app: INestApplication, code?: string, forwardedFor?: string) => {
  let req = request(app.getHttpServer()).get('/api/v1/audits/aud_unknown');
  if (code !== undefined) req = req.set('X-Access-Code', code);
  if (forwardedFor) req = req.set('X-Forwarded-For', forwardedFor);
  return req;
};

async function waitUntilDone(app: INestApplication, id: string) {
  for (let i = 0; i < 400; i++) {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audits/${id}`)
      .set('X-Access-Code', CODE);
    if (res.body.status !== 'running') return res;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('audit did not finish in time');
}

describe('Access code on the audits routes', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('accepts the right code: POST answers 202', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/api/v1/audits')
      .set('X-Access-Code', CODE)
      .send(validBody());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('running');
    await waitUntilDone(app, res.body.id);
  });

  it('answers 401 ACCESS_DENIED when the code is missing', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/api/v1/audits')
      .send(validBody());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'ACCESS_DENIED', message: 'Access denied.' },
    });
  });

  it.each([
    ['a wrong code', 'not-the-right-code-at-all-1234'],
    ['the right code with one character missing', CODE.slice(0, -1)],
    ['the right code with one character added', `${CODE}x`],
    ['an empty code', ''],
    ['a very long code', 'a'.repeat(5000)],
  ])(
    'answers 401 for %s (also when the length differs)',
    async (_why, sent) => {
      app = await buildApp();
      const res = await probe(app, sent);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCESS_DENIED');
    },
  );

  it('protects every audits route, not only POST', async () => {
    app = await buildApp();
    for (const path of [
      '/api/v1/audits/aud_x',
      '/api/v1/audits/aud_x/findings',
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(401);
    }
    // with the right code the same routes get through (404: no such audit)
    const ok = await probe(app, CODE);
    expect(ok.status).toBe(404);
  });

  it('keeps /health open, with or without a code', async () => {
    app = await buildApp();
    expect((await request(app.getHttpServer()).get('/health')).status).toBe(
      200,
    );
    const wrong = await request(app.getHttpServer())
      .get('/health')
      .set('X-Access-Code', 'wrong');
    expect(wrong.status).toBe(200);
  });

  it('does not count /health calls as wrong attempts', async () => {
    app = await buildApp();
    for (let i = 0; i < 30; i++) {
      await request(app.getHttpServer()).get('/health');
    }
    expect((await probe(app, 'wrong-1')).status).toBe(401);
  });

  it('allows the X-Access-Code header in the browser pre-check (CORS)', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .options('/api/v1/audits')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-access-code');
    expect(res.status).toBe(204);
    expect(
      String(res.headers['access-control-allow-headers']).toLowerCase(),
    ).toContain('x-access-code');
  });
});

describe('Rate limit on wrong codes', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('answers 401 ten times, then 429 RATE_LIMITED', async () => {
    app = await buildApp();
    for (let i = 1; i <= 10; i++) {
      expect((await probe(app, `wrong-${i}`)).status).toBe(401);
    }
    const eleventh = await probe(app, 'wrong-11');
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe('RATE_LIMITED');
    expect(Number(eleventh.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('refuses even the RIGHT code while blocked (so guessing cannot continue)', async () => {
    app = await buildApp();
    for (let i = 0; i < 10; i++) await probe(app, 'wrong');
    const res = await probe(app, CODE);
    expect(res.status).toBe(429);
  });

  it('does not count a right code as an attempt', async () => {
    app = await buildApp();
    for (let i = 0; i < 25; i++) {
      expect((await probe(app, CODE)).status).toBe(404); // passed the guard
    }
    for (let i = 0; i < 10; i++) {
      expect((await probe(app, 'wrong')).status).toBe(401);
    }
    expect((await probe(app, 'wrong')).status).toBe(429);
  });

  it('does not count a missing header: 20 requests without it never give 429', async () => {
    app = await buildApp();
    for (let i = 0; i < 20; i++) {
      expect((await probe(app)).status).toBe(401);
    }
    // the counter is still empty: 10 wrong codes are needed, the 11th is 429
    for (let i = 0; i < 10; i++) {
      expect((await probe(app, 'wrong')).status).toBe(401);
    }
    expect((await probe(app, 'wrong')).status).toBe(429);
  });

  it('still lets the right code in after many missing-header requests', async () => {
    app = await buildApp();
    for (let i = 0; i < 20; i++) await probe(app);
    const res = await request(app.getHttpServer())
      .post('/api/v1/audits')
      .set('X-Access-Code', CODE)
      .send(validBody());
    expect(res.status).toBe(202);
    await waitUntilDone(app, res.body.id);
  });

  it('never counts OPTIONS (CORS preflight) requests', async () => {
    app = await buildApp();
    for (let i = 0; i < 30; i++) {
      const res = await request(app.getHttpServer())
        .options('/api/v1/audits')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-access-code');
      expect(res.status).toBe(204);
    }
    for (let i = 0; i < 10; i++) {
      expect((await probe(app, 'wrong')).status).toBe(401);
    }
    expect((await probe(app, 'wrong')).status).toBe(429);
  });

  it('lets exactly ten through when fifteen wrong requests arrive at once', async () => {
    app = await buildApp();
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => probe(app, `wrong-${i}`)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it('keeps a separate counter for every client IP (behind one proxy)', async () => {
    app = await buildApp({ env: { TRUST_PROXY_HOPS: '1' } });
    const attacker = '203.0.113.10';
    const neighbour = '203.0.113.20';

    for (let i = 0; i < 10; i++) await probe(app, 'wrong', attacker);
    expect((await probe(app, 'wrong', attacker)).status).toBe(429);

    // another person is not locked out by the attacker
    expect((await probe(app, 'wrong', neighbour)).status).toBe(401);
    expect((await probe(app, CODE, neighbour)).status).toBe(404);
    expect((await probe(app, CODE, attacker)).status).toBe(429);
  });

  it('cannot be dodged by faking the start of X-Forwarded-For', async () => {
    app = await buildApp({ env: { TRUST_PROXY_HOPS: '1' } });
    // The proxy adds the real address LAST. Whatever the client puts in front is ignored.
    for (let i = 0; i < 10; i++) {
      await probe(app, 'wrong', `9.9.9.${i}, 203.0.113.10`);
    }
    expect((await probe(app, 'wrong', '8.8.8.8, 203.0.113.10')).status).toBe(
      429,
    );
  });

  it('ignores X-Forwarded-For completely when no proxy is configured', async () => {
    app = await buildApp(); // TRUST_PROXY_HOPS not set = 0
    for (let i = 0; i < 10; i++) {
      await probe(app, 'wrong', `198.51.100.${i}`);
    }
    expect((await probe(app, 'wrong', '198.51.100.99')).status).toBe(429);
  });
});

describe('The access code never leaks', () => {
  const written: string[] = [];
  const spies: { mockRestore(): void }[] = [];
  let app: INestApplication;

  beforeEach(() => {
    written.length = 0;
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    spies.push(
      vi.spyOn(process.stdout, 'write').mockImplementation(capture),
      vi.spyOn(process.stderr, 'write').mockImplementation(capture),
    );
  });
  afterEach(async () => {
    while (spies.length) spies.pop()!.mockRestore();
    await app?.close();
  });

  it('is not in any log line, response body or response header', async () => {
    app = await buildApp({ logs: true }); // logs ON on purpose
    const nearMiss = `${CODE.slice(0, -1)}Z`;
    const seen: string[] = [];
    const collect = (res: request.Response) =>
      seen.push(
        JSON.stringify(res.body),
        res.text,
        JSON.stringify(res.headers),
      );

    collect(await probe(app, nearMiss)); // a typo of the real code
    collect(await probe(app)); // missing
    collect(await probe(app, CODE)); // right
    const created = await request(app.getHttpServer())
      .post('/api/v1/audits')
      .set('X-Access-Code', CODE)
      .send(validBody());
    collect(created);
    await waitUntilDone(app, created.body.id);
    for (let i = 0; i < 12; i++) collect(await probe(app, nearMiss)); // up to a 429
    collect(
      await request(app.getHttpServer())
        .options('/api/v1/audits')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST'),
    );

    const logs = written.join('');
    expect(logs).toContain('aud_'); // logging really happened
    for (const text of [...seen, logs]) {
      expect(text).not.toContain(CODE);
      expect(text).not.toContain(nearMiss); // not even what a client sent
    }
  });

  it('is not echoed when the body is broken JSON', async () => {
    app = await buildApp({ logs: true });
    const res = await request(app.getHttpServer())
      .post('/api/v1/audits')
      .set('X-Access-Code', CODE)
      .set('Content-Type', 'application/json')
      .send('{"label": ');
    expect(res.status).toBe(400);
    expect(res.text).not.toContain(CODE);
    expect(written.join('')).not.toContain(CODE);
  });
});

describe('Fail closed at start-up', () => {
  const saved = {
    code: process.env.AUDIT_ACCESS_CODE,
    open: process.env.ALLOW_OPEN_API,
  };
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  afterEach(() => {
    restore('AUDIT_ACCESS_CODE', saved.code);
    restore('ALLOW_OPEN_API', saved.open);
  });

  // This builds the real app with the real settings check (no override).
  const start = () =>
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GATEWAY_FACTORY)
      .useValue(() => new FakeGateway(tables()))
      .compile();

  it('does not start without AUDIT_ACCESS_CODE and without ALLOW_OPEN_API', async () => {
    delete process.env.AUDIT_ACCESS_CODE;
    delete process.env.ALLOW_OPEN_API;
    await expect(start()).rejects.toThrow(/AUDIT_ACCESS_CODE is not set/);
  });

  it('does not start with a code that is too short', async () => {
    process.env.AUDIT_ACCESS_CODE = 'short-code-123';
    delete process.env.ALLOW_OPEN_API;
    await expect(start()).rejects.toThrow(/at least 24 characters/);
  });

  it('does not fall back to open with a too short code, even with ALLOW_OPEN_API=yes', async () => {
    process.env.AUDIT_ACCESS_CODE = 'short-code-123';
    process.env.ALLOW_OPEN_API = 'yes';
    await expect(start()).rejects.toThrow(/at least 24 characters/);
  });

  it('starts with a good code', async () => {
    process.env.AUDIT_ACCESS_CODE = CODE;
    delete process.env.ALLOW_OPEN_API;
    const moduleRef = await start();
    await moduleRef.close();
  });

  it('starts open only with ALLOW_OPEN_API=yes', async () => {
    delete process.env.AUDIT_ACCESS_CODE;
    process.env.ALLOW_OPEN_API = 'yes';
    const moduleRef = await start();
    await moduleRef.close();
  });

  describe('resolveAccessConfig', () => {
    it('needs 24 characters: 23 fail, 24 pass', () => {
      expect(MIN_ACCESS_CODE_LENGTH).toBe(24);
      expect(() =>
        resolveAccessConfig({ AUDIT_ACCESS_CODE: 'a'.repeat(23) }),
      ).toThrow();
      expect(
        resolveAccessConfig({ AUDIT_ACCESS_CODE: 'a'.repeat(24) }),
      ).toEqual({ mode: 'code', code: 'a'.repeat(24) });
    });

    it('treats only "yes" as permission to run open', () => {
      for (const value of ['no', 'true', '1', 'y', '']) {
        expect(() => resolveAccessConfig({ ALLOW_OPEN_API: value })).toThrow();
      }
      expect(resolveAccessConfig({ ALLOW_OPEN_API: 'YES' })).toEqual({
        mode: 'open',
      });
    });

    it('prefers the code when both are set', () => {
      expect(
        resolveAccessConfig({
          AUDIT_ACCESS_CODE: CODE,
          ALLOW_OPEN_API: 'yes',
        }),
      ).toEqual({ mode: 'code', code: CODE });
    });

    it('never puts the code in an error message', () => {
      const tooShort = 'SHORT-but-secret-1234';
      for (const env of [
        { AUDIT_ACCESS_CODE: tooShort },
        { AUDIT_ACCESS_CODE: tooShort, ALLOW_OPEN_API: 'yes' },
      ]) {
        try {
          resolveAccessConfig(env);
          throw new Error('should have thrown');
        } catch (e) {
          expect((e as Error).message).not.toContain(tooShort);
        }
      }
    });
  });

  describe('resolveTrustProxyHops', () => {
    it('defaults to 0 and accepts 0 to 5', () => {
      expect(resolveTrustProxyHops({})).toBe(0);
      expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '' })).toBe(0);
      expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '1' })).toBe(1);
      expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '5' })).toBe(5);
    });
    it('refuses anything else', () => {
      for (const v of ['-1', '6', 'abc', '1.5', 'true']) {
        expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: v })).toThrow();
      }
    });
  });
});

describe('Building blocks', () => {
  it('safeEqual compares correctly and does not crash on different lengths', () => {
    expect(safeEqual(CODE, CODE)).toBe(true);
    expect(safeEqual(CODE, `${CODE}x`)).toBe(false);
    expect(safeEqual(CODE, CODE.slice(1))).toBe(false);
    expect(safeEqual(CODE, 'x'.repeat(CODE.length))).toBe(false);
    expect(safeEqual('', CODE)).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  describe('AttemptLimiter (with a fake clock)', () => {
    const MIN = 60_000;
    it('blocks after 10 wrong tries and frees the client after 15 minutes', () => {
      let now = 1_000_000;
      const limiter = new AttemptLimiter(10, 15 * MIN, () => now);
      for (let i = 0; i < 9; i++) limiter.recordFailure('a');
      expect(limiter.retryAfterSeconds('a')).toBe(0);
      limiter.recordFailure('a');
      expect(limiter.retryAfterSeconds('a')).toBe(15 * 60);

      now += 10 * MIN;
      expect(limiter.retryAfterSeconds('a')).toBe(5 * 60);
      now += 5 * MIN + 1;
      expect(limiter.retryAfterSeconds('a')).toBe(0);
    });

    it('counts every client on its own', () => {
      const limiter = new AttemptLimiter(3, 15 * MIN);
      for (let i = 0; i < 3; i++) limiter.recordFailure('a');
      expect(limiter.retryAfterSeconds('a')).toBeGreaterThan(0);
      expect(limiter.retryAfterSeconds('b')).toBe(0);
    });

    it('keeps its memory bounded', () => {
      const limiter = new AttemptLimiter(10, 15 * MIN, Date.now, 100);
      for (let i = 0; i < 1000; i++) limiter.recordFailure(`client-${i}`);
      // the newest clients are still tracked, the oldest were dropped
      limiter.recordFailure('client-999');
      expect(
        (limiter as unknown as { attempts: Map<string, number[]> }).attempts
          .size,
      ).toBeLessThanOrEqual(100);
    });
  });

  describe('clientKey', () => {
    it('keeps IPv4 as it is and unwraps IPv4-in-IPv6', () => {
      expect(clientKey('203.0.113.10')).toBe('203.0.113.10');
      expect(clientKey('::ffff:203.0.113.10')).toBe('203.0.113.10');
      expect(clientKey(undefined)).toBe('unknown');
    });
    it('treats one IPv6 /64 as one client, and different /64s as different', () => {
      const a = clientKey('2001:db8:abcd:12:aaaa:bbbb:cccc:dddd');
      const b = clientKey('2001:db8:abcd:12::1');
      const c = clientKey('2001:db8:abcd:13::1');
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });
  });
});
