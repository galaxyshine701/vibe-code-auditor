import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import {
  DEFAULT_FRONTEND_ORIGIN,
  configureApp,
  resolveAllowedOrigin,
} from '../../src/app.setup.js';
import {
  GATEWAY_FACTORY,
  type GatewayFactory,
} from '../../src/audits/audits.service.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';

// Made-up values that are easy to search for. They are not real keys.
const PUBLISHABLE = 'PUBLISHABLE-KEY-VALUE-9f8e7d';
const SECRET = 'SECRET-KEY-VALUE-1a2b3c';
const PROJECT_URL = 'https://abcdefghijklmnopqrst.supabase.co';

const validBody = () => ({
  label: 'Demo project',
  projectUrl: PROJECT_URL,
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
});

const demoTables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
  { name: 'hotels', policy: 'public-read', ownerColumn: null },
];

async function buildApp(
  factory: GatewayFactory,
  options: { quietLogs?: boolean; env?: Record<string, string> } = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(factory)
    .compile();
  const app = moduleRef.createNestApplication();
  // Nest's test module hides logs by default; turn the real console logger on
  // when a test wants to look at the log lines.
  app.useLogger(options.quietLogs === false ? new ConsoleLogger() : false);
  configureApp(app, options.env ?? {});
  await app.init();
  return app;
}

async function waitUntilDone(app: INestApplication, id: string) {
  for (let i = 0; i < 400; i++) {
    const res = await request(app.getHttpServer()).get(`/api/v1/audits/${id}`);
    if (res.body.status !== 'running') return res;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('audit did not finish in time');
}

const post = (app: INestApplication, body: unknown) =>
  request(app.getHttpServer())
    .post('/api/v1/audits')
    .send(body as object);

/** A fake project that waits at the first step until `release()` is called. */
class GatedGateway extends FakeGateway {
  release!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  override async fetchOpenApi(): Promise<unknown> {
    await this.gate;
    return super.fetchOpenApi();
  }
}

/** A fake project whose error message quotes the secret key (worst case). */
class LeakyGateway extends FakeGateway {
  override fetchOpenApi(): Promise<unknown> {
    return Promise.reject(new Error(`request failed for key ${SECRET}`));
  }
}

describe('POST /api/v1/audits and the GET routes', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('answers 202 at once with the id and "running", then finishes in the background', async () => {
    const fake = new GatedGateway(demoTables());
    app = await buildApp(() => fake);

    const res = await post(app, validBody());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('running');
    expect(res.body.id).toMatch(/^aud_[0-9a-f]+$/);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'status']);

    // the work has not finished yet: the fake is still waiting at its gate
    const midway = await request(app.getHttpServer()).get(
      `/api/v1/audits/${res.body.id}`,
    );
    expect(midway.body.status).toBe('running');

    fake.release();
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.status).toBe('completed');
    expect(done.body.cleanup).toBe('ok');
    expect(done.body.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(done.body.target).toEqual({
      label: 'Demo project',
      projectUrl: PROJECT_URL,
    });
    expect(done.body.summary).toEqual({
      leaked: 1,
      blocked: 1,
      inconclusive: 1,
    });
    expect(done.body.modules).toEqual([
      {
        id: 'data-access-prover',
        name: 'Data Access Prover',
        status: 'completed',
        progress: 100,
      },
    ]);
  });

  it('returns the findings in the contract shape', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()));
    const { body } = await post(app, validBody());
    await waitUntilDone(app, body.id);

    const res = await request(app.getHttpServer()).get(
      `/api/v1/audits/${body.id}/findings`,
    );
    expect(res.status).toBe(200);
    const byTable = Object.fromEntries(
      res.body.findings.map((f: { table: string }) => [f.table, f]),
    );
    expect(byTable.bookings.verdict).toBe('LEAKED');
    expect(byTable.profiles.verdict).toBe('BLOCKED');
    expect(byTable.hotels.verdict).toBe('INCONCLUSIVE');
    expect(byTable.bookings.evidence.operations.length).toBeGreaterThan(0);
    expect(byTable.bookings.retest).toEqual({
      status: 'not_run',
      lastRunAt: null,
    });
  });

  it('returns an empty findings list while the audit is still running', async () => {
    const fake = new GatedGateway(demoTables());
    app = await buildApp(() => fake);
    const { body } = await post(app, validBody());
    const res = await request(app.getHttpServer()).get(
      `/api/v1/audits/${body.id}/findings`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ findings: [] });
    fake.release();
    await waitUntilDone(app, body.id);
  });

  it('answers 404 NOT_FOUND for an unknown audit or route', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()));
    for (const path of [
      '/api/v1/audits/aud_nope',
      '/api/v1/audits/aud_nope/findings',
      '/api/v1/nothing-here',
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('keeps /health working at the root', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()));
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('Keys are write-only', () => {
  let app: INestApplication;
  const written: string[] = [];
  const spies: { mockRestore(): void }[] = [];

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

  const noKeysIn = (text: string) => {
    expect(text).not.toContain(PUBLISHABLE);
    expect(text).not.toContain(SECRET);
  };

  it('never shows a key in any response, any log line, or the findings', async () => {
    // logs stay ON here on purpose, so the log lines can be checked too
    app = await buildApp(() => new FakeGateway(demoTables()), {
      quietLogs: false,
    });
    const responses: string[] = [];

    const created = await post(app, validBody());
    responses.push(JSON.stringify(created.body));
    const done = await waitUntilDone(app, created.body.id);
    responses.push(JSON.stringify(done.body));
    const findings = await request(app.getHttpServer()).get(
      `/api/v1/audits/${created.body.id}/findings`,
    );
    responses.push(JSON.stringify(findings.body));

    // error responses too
    responses.push(
      JSON.stringify(
        (await post(app, { ...validBody(), projectUrl: 'x' })).body,
      ),
      JSON.stringify(
        (await post(app, { ...validBody(), confirmTestProject: false })).body,
      ),
    );

    expect(written.join('')).toContain('aud_'); // logging really happened
    responses.forEach(noKeysIn);
    noKeysIn(written.join(''));
  });

  it('hides a key even when an internal error message quotes it', async () => {
    app = await buildApp(() => new LeakyGateway(demoTables()), {
      quietLogs: false,
    });
    const created = await post(app, validBody());
    const done = await waitUntilDone(app, created.body.id);
    expect(done.body.status).toBe('failed');
    expect(done.body.error.code).toBe('PROVER_FAILED');
    expect(done.body.error.message).toContain('[REDACTED]');
    noKeysIn(JSON.stringify(done.body));
    noKeysIn(written.join(''));
  });

  it('does not echo the body when the JSON is broken', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()), {
      quietLogs: false,
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/audits')
      .set('Content-Type', 'application/json')
      .send(`{"serviceKey":"${SECRET}","anonKey":"${PUBLISHABLE}",`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    noKeysIn(res.text);
    noKeysIn(written.join(''));
  });
});

describe('Input checks', () => {
  let app: INestApplication;
  let factory: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    factory = vi.fn(() => new FakeGateway(demoTables()));
    app = await buildApp(factory as unknown as GatewayFactory);
  });
  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['http instead of https', 'http://abcdefghijklmnopqrst.supabase.co'],
    ['another domain', 'https://example.com'],
    ['look-alike domain', 'https://abcdefghij.supabase.co.evil.com'],
    ['extra sub-domain', 'https://a.b.supabase.co'],
    ['a port', 'https://abcdefghij.supabase.co:8443'],
    ['a login in the URL', 'https://user:pw@abcdefghij.supabase.co'],
    ['a path', 'https://abcdefghij.supabase.co/rest/v1'],
    ['a query', 'https://abcdefghij.supabase.co/?x=1'],
    ['localhost', 'https://localhost'],
    ['not a URL', 'hello'],
    ['empty', ''],
  ])('refuses a project URL with %s', async (_why, projectUrl) => {
    const res = await post(app, { ...validBody(), projectUrl });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(factory).not.toHaveBeenCalled();
  });

  it('refuses a project URL that is not text', async () => {
    const res = await post(app, { ...validBody(), projectUrl: 42 });
    expect(res.status).toBe(400);
  });

  it('accepts the plain URL, also with a trailing slash or capitals', async () => {
    const res = await post(app, {
      ...validBody(),
      projectUrl: 'HTTPS://AbcdefGHIJ.supabase.co/',
    });
    expect(res.status).toBe(202);
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.target.projectUrl).toBe('https://abcdefghij.supabase.co');
  });

  it.each([
    ['missing', undefined],
    ['false', false],
    ['the text "true"', 'true'],
    ['the text "yes"', 'yes'],
    ['1', 1],
  ])('refuses when confirmTestProject is %s', async (_why, value) => {
    const body: Record<string, unknown> = validBody();
    if (value === undefined) delete body.confirmTestProject;
    else body.confirmTestProject = value;
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(res.body.error.message).toContain('confirmTestProject');
    expect(factory).not.toHaveBeenCalled();
  });

  it('does not trust the CONFIRM_TEST_PROJECT setting of the server', async () => {
    const before = process.env.CONFIRM_TEST_PROJECT;
    process.env.CONFIRM_TEST_PROJECT = 'yes';
    try {
      const body: Record<string, unknown> = validBody();
      delete body.confirmTestProject;
      expect((await post(app, body)).status).toBe(400);
    } finally {
      if (before === undefined) delete process.env.CONFIRM_TEST_PROJECT;
      else process.env.CONFIRM_TEST_PROJECT = before;
    }
  });

  it('works without any CONFIRM_TEST_PROJECT setting on the server', async () => {
    const before = process.env.CONFIRM_TEST_PROJECT;
    delete process.env.CONFIRM_TEST_PROJECT;
    try {
      const res = await post(app, validBody());
      expect(res.status).toBe(202);
      await waitUntilDone(app, res.body.id);
    } finally {
      if (before !== undefined) process.env.CONFIRM_TEST_PROJECT = before;
    }
  });

  it.each(['anonKey', 'serviceKey'])('refuses a missing %s', async (field) => {
    const body: Record<string, unknown> = validBody();
    delete body[field];
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain(field);
    expect(factory).not.toHaveBeenCalled();
  });

  it('refuses a body that is not an object', async () => {
    for (const body of [[], 'text', null]) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/audits')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body));
      expect(res.status).toBe(400);
    }
  });
});

describe('Only one audit at a time', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('answers 409 to a second audit while one runs, then allows a new one', async () => {
    const fake = new GatedGateway(demoTables());
    const factory = vi.fn(() => fake);
    app = await buildApp(factory as unknown as GatewayFactory);

    const first = await post(app, validBody());
    expect(first.status).toBe(202);

    const second = await post(app, validBody());
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('AUDIT_IN_PROGRESS');
    expect(factory).toHaveBeenCalledTimes(1); // the second one never touched a project

    fake.release();
    await waitUntilDone(app, first.body.id);

    const third = await post(app, validBody());
    expect(third.status).toBe(202);
    expect(third.body.id).not.toBe(first.body.id);
    await waitUntilDone(app, third.body.id);
  });

  it('answers 409 to two requests sent at the same moment (only one wins)', async () => {
    const fake = new GatedGateway(demoTables());
    app = await buildApp(() => fake);
    const results = await Promise.all([
      post(app, validBody()),
      post(app, validBody()),
      post(app, validBody()),
    ]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([202, 409, 409]);
    fake.release();
    const winner = results.find((r) => r.status === 202)!;
    await waitUntilDone(app, winner.body.id);
  });

  it('marks the audit failed and frees the slot when the Prover refuses', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: String(i) }));
    const fake = new FakeGateway([
      { name: 'big', policy: 'off', ownerColumn: 'user_id', rows },
    ]);
    app = await buildApp(() => fake);

    const first = await post(app, validBody());
    const done = await waitUntilDone(app, first.body.id);
    expect(done.body.status).toBe('failed');
    expect(done.body.error.code).toBe('TOO_MUCH_DATA');
    expect(done.body.modules[0].status).toBe('failed');
    expect(done.body.summary).toEqual({
      leaked: 0,
      blocked: 0,
      inconclusive: 0,
    });

    const next = await post(app, validBody());
    expect(next.status).toBe(202);
    await waitUntilDone(app, next.body.id);
  });
});

describe('Leftover test users', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('shows cleanup "failed" and a by-hand note when the leftover user cannot be removed', async () => {
    const fake = new FakeGateway(demoTables(), {
      createUserTimesOutOnCall: 1,
      failDeleteUserByEmail: true,
    });
    app = await buildApp(() => fake);

    const created = await post(app, validBody());
    const done = await waitUntilDone(app, created.body.id);

    expect(done.body.status).toBe('failed');
    expect(done.body.cleanup).toBe('failed');
    expect(done.body.cleanupNote).toContain('vca-*@example.com');
    expect(done.body.cleanupNote).toContain('by hand');
    expect(done.body.cleanupNote).toContain('Supabase Auth');
    // the leftover really exists in the fake project
    expect(fake.users.size).toBe(1);
    // and the note never carries a key
    expect(JSON.stringify(done.body)).not.toContain(SECRET);
    expect(JSON.stringify(done.body)).not.toContain(PUBLISHABLE);
  });

  it('shows cleanup "ok" when the timed-out user was found by email and removed', async () => {
    const fake = new FakeGateway(demoTables(), { createUserTimesOutOnCall: 1 });
    app = await buildApp(() => fake);
    const created = await post(app, validBody());
    const done = await waitUntilDone(app, created.body.id);
    expect(done.body.status).toBe('failed');
    expect(done.body.cleanup).toBe('ok');
    expect(done.body).not.toHaveProperty('cleanupNote');
    expect(fake.users.size).toBe(0);
  });

  it('has no cleanupNote when cleanup is ok', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()));
    const created = await post(app, validBody());
    const done = await waitUntilDone(app, created.body.id);
    expect(done.body.cleanup).toBe('ok');
    expect(done.body).not.toHaveProperty('cleanupNote');
  });
});

describe('CORS', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });
  const origin = (res: request.Response) =>
    res.headers['access-control-allow-origin'];

  it('allows only http://localhost:3000 by default', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()));
    const ok = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3000');
    expect(origin(ok)).toBe('http://localhost:3000');

    const evil = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(origin(evil)).toBe('http://localhost:3000'); // never the evil origin
    expect(origin(evil)).not.toBe('https://evil.example');
    expect(origin(evil)).not.toBe('*');
  });

  it('uses FRONTEND_ORIGIN from the settings', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()), {
      env: { FRONTEND_ORIGIN: 'https://app.example.com' },
    });
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://app.example.com');
    expect(origin(res)).toBe('https://app.example.com');
    const local = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3000');
    expect(origin(local)).toBe('https://app.example.com');
  });

  it('answers the browser pre-check (OPTIONS) for POST /audits', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()));
    const res = await request(app.getHttpServer())
      .options('/api/v1/audits')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(origin(res)).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('resolveAllowedOrigin: default, plain origin, and refusals', () => {
    expect(resolveAllowedOrigin({})).toBe(DEFAULT_FRONTEND_ORIGIN);
    expect(resolveAllowedOrigin({ FRONTEND_ORIGIN: '  ' })).toBe(
      DEFAULT_FRONTEND_ORIGIN,
    );
    expect(
      resolveAllowedOrigin({ FRONTEND_ORIGIN: 'https://app.example.com/x/' }),
    ).toBe('https://app.example.com');
    expect(() => resolveAllowedOrigin({ FRONTEND_ORIGIN: '*' })).toThrow();
    expect(() =>
      resolveAllowedOrigin({ FRONTEND_ORIGIN: 'ftp://app.example.com' }),
    ).toThrow();
  });
});
