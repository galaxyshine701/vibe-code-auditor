import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AUDIT_REPOSITORY } from '../../src/audits/audit-repository.js';
import {
  AUDIT_TIMING,
  AuditsService,
  GATEWAY_FACTORY,
  type AuditTiming,
  type GatewayFactory,
} from '../../src/audits/audits.service.js';
import { resolvePlatformConfig } from '../../src/audits/platform-config.js';
import { INTERRUPTED_CLEANUP_NOTE } from '../../src/audits/sweeper.js';
import { runProver } from '../../src/prover/prover.js';
import { ProverError } from '../../src/prover/types.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';
import { InMemoryAuditRepository } from './in-memory-audit-repository.js';
import { sampleRecord } from './repository-contract.js';

// Made-up values that are easy to search for. They are not real keys.
const PUBLISHABLE = 'PUBLISHABLE-KEY-VALUE-9f8e7d';
const SECRET = 'SECRET-KEY-VALUE-1a2b3c';
const PROJECT_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const BASE = '/api/v1/audits';

const validBody = () => ({
  label: 'Persistence test',
  projectUrl: PROJECT_URL,
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
});
const retestBody = () => ({
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
});

const demoTables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
  { name: 'hotels', policy: 'public-read', ownerColumn: null },
];
/** Only a protected table: the audit ends with a BLOCKED finding (certificate possible). */
const safeTables = (): FakeTable[] => [
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
];

const FAST: AuditTiming = { flushMs: 0, retryBaseMs: 5, retryMaxMs: 20 };

async function buildApp(
  repo: InMemoryAuditRepository,
  factory: GatewayFactory,
  timing: AuditTiming = FAST,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(factory)
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(repo)
    .overrideProvider(AUDIT_TIMING)
    .useValue(timing)
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'open' })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  configureApp(app, {});
  await app.init();
  return app;
}

/** What main.ts does before the server listens. */
const boot = (app: INestApplication) => app.get(AuditsService).bootCheck();

const api = (app: INestApplication) => request(app.getHttpServer());

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string,
) {
  for (let i = 0; i < 600; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

async function waitUntilDone(app: INestApplication, id: string) {
  for (let i = 0; i < 600; i++) {
    const res = await api(app).get(`${BASE}/${id}`);
    if (res.body.status !== 'running') return res;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('audit did not finish in time');
}

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

/** A factory that hands out one gateway per run, in order. */
const inOrder = (...gateways: FakeGateway[]): GatewayFactory => {
  const rest = [...gateways];
  return () => {
    const next = rest.shift();
    if (!next) throw new Error('unexpected extra run');
    return next;
  };
};

describe('audit state in the audit store', () => {
  const apps: INestApplication[] = [];
  const open = async (...args: Parameters<typeof buildApp>) => {
    const app = await buildApp(...args);
    apps.push(app);
    return app;
  };
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  // (a) a finished audit survives a restart
  it('(a) a completed audit answers 200 with the same body after a restart', async () => {
    const repo = new InMemoryAuditRepository();
    const app1 = await open(repo, () => new FakeGateway(safeTables()));
    const started = await api(app1).post(BASE).send(validBody());
    expect(started.status).toBe(202);
    const id = started.body.id as string;
    const before = await waitUntilDone(app1, id);
    expect(before.body.status).toBe('completed');
    const findingsBefore = await api(app1).get(`${BASE}/${id}/findings`);
    const certBefore = await api(app1).get(`${BASE}/${id}/certificate`);
    expect(certBefore.status).toBe(200);
    await app1.close();

    // "restart": a new application over the same store
    const app2 = await open(repo, () => new FakeGateway(safeTables()));
    expect(await boot(app2)).toBe(0);
    const after = await api(app2).get(`${BASE}/${id}`);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(before.body);
    expect((await api(app2).get(`${BASE}/${id}/findings`)).body).toEqual(
      findingsBefore.body,
    );
    // same record, same fingerprint
    expect((await api(app2).get(`${BASE}/${id}/certificate`)).body).toEqual(
      certBefore.body,
    );
  });

  // (b) a run that was cut off is closed at boot
  it('(b) a row left running by a killed process becomes failed / INTERRUPTED at boot', async () => {
    const repo = new InMemoryAuditRepository();
    const gate = new GatedGateway(demoTables());
    const app1 = await open(repo, () => gate);
    const started = await api(app1).post(BASE).send(validBody());
    const id = started.body.id as string;
    expect((await api(app1).get(`${BASE}/${id}`)).body.status).toBe('running');

    // The process is "killed": app1 never writes again until the gate opens.
    // A new process boots over the same store.
    const app2 = await open(repo, () => new FakeGateway(demoTables()));
    expect(await boot(app2)).toBe(1);
    const res = await api(app2).get(`${BASE}/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.error.code).toBe('INTERRUPTED');
    expect(res.body.cleanup).toBe('failed');
    expect(res.body.cleanupNote).toBe(INTERRUPTED_CLEANUP_NOTE);
    expect(res.body.cleanupNote).toContain('vca-*@example.com');
    expect(res.body.modules[0].status).toBe('failed');
    // no certificate for an audit that never finished
    expect((await api(app2).get(`${BASE}/${id}/certificate`)).status).toBe(409);
    // and the new process can run audits again
    const next = await api(app2).post(BASE).send(validBody());
    expect(next.status).toBe(202);
    await waitUntilDone(app2, next.body.id);
    gate.release();
    await waitFor(() => repo.refused >= 1, 'the old run to be refused');
  });

  it('(b) does not touch rows that are not running', async () => {
    const repo = new InMemoryAuditRepository();
    const app1 = await open(repo, () => new FakeGateway(safeTables()));
    const started = await api(app1).post(BASE).send(validBody());
    const before = await waitUntilDone(app1, started.body.id);
    const app2 = await open(repo, () => new FakeGateway(safeTables()));
    expect(await boot(app2)).toBe(0);
    expect((await api(app2).get(`${BASE}/${started.body.id}`)).body).toEqual(
      before.body,
    );
  });

  // (c) a re-test row goes back to completed, the old findings stay
  it('(c) a re-test cut off by a restart: audit completed, lastRetest failed, old findings kept', async () => {
    const repo = new InMemoryAuditRepository();
    const zombie = new GatedGateway(demoTables());
    const app1 = await open(
      repo,
      inOrder(new FakeGateway(demoTables()), zombie),
    );
    const id = (await api(app1).post(BASE).send(validBody())).body.id as string;
    const first = await waitUntilDone(app1, id);
    expect(first.body.status).toBe('completed');
    const findingsBefore = (await api(app1).get(`${BASE}/${id}/findings`)).body;

    expect(
      (await api(app1).post(`${BASE}/${id}/retest`).send(retestBody())).status,
    ).toBe(202);
    expect((await api(app1).get(`${BASE}/${id}`)).body.lastRetest.status).toBe(
      'running',
    );

    const app2 = await open(repo, () => new FakeGateway(demoTables()));
    expect(await boot(app2)).toBe(1);
    const res = await api(app2).get(`${BASE}/${id}`);
    expect(res.body.status).toBe('completed');
    expect(res.body.error).toBeUndefined();
    expect(res.body.lastRetest.status).toBe('failed');
    expect(res.body.lastRetest.error.code).toBe('INTERRUPTED');
    expect(res.body.cleanup).toBe('failed');
    expect(res.body.cleanupNote).toContain('vca-*@example.com');
    // the old findings are exactly as they were
    const findingsAfter = (await api(app2).get(`${BASE}/${id}/findings`)).body;
    expect(findingsAfter).toEqual(findingsBefore);
    zombie.release();
    await waitFor(() => repo.refused >= 1, 'the old run to be refused');
  });

  // (d) the late write of a swept runner changes 0 rows
  it('(d) after a sweep, the old runner cannot write: its writes change 0 rows, its cleanup still runs', async () => {
    const repo = new InMemoryAuditRepository();
    const zombie = new GatedGateway(demoTables());
    const app1 = await open(repo, () => zombie);
    const id = (await api(app1).post(BASE).send(validBody())).body.id as string;

    const app2 = await open(repo, () => new FakeGateway(demoTables()));
    await boot(app2);
    const swept = (await api(app2).get(`${BASE}/${id}`)).body;
    expect(swept.status).toBe('failed');
    const sweptRow = structuredClone(repo.rows.get(id)!);

    zombie.release();
    // the old run goes on to the end; its final write is refused
    await waitFor(() => repo.refused >= 1, 'a refused write');
    await waitFor(
      () =>
        zombie.users.size === 0 &&
        repo.calls.filter((c) => c === 'finish').length >= 2,
      'the old run to finish',
    );
    // cleanup of the test project ran even though the write was refused
    expect(zombie.users.size).toBe(0);
    for (const rows of zombie.data.values()) expect(rows).toHaveLength(0);
    // the stored row is exactly what the sweeper wrote
    expect(repo.rows.get(id)).toEqual(sweptRow);
    expect((await api(app2).get(`${BASE}/${id}`)).body).toEqual(swept);
  });

  it('(d) a run id from a swept re-test cannot overwrite the NEXT re-test of the same audit', async () => {
    const repo = new InMemoryAuditRepository();
    const zombie = new GatedGateway(demoTables());
    const second = new GatedGateway(safeTables());
    const app1 = await open(
      repo,
      inOrder(new FakeGateway(demoTables()), zombie),
    );
    const id = (await api(app1).post(BASE).send(validBody())).body.id as string;
    await waitUntilDone(app1, id);
    await api(app1).post(`${BASE}/${id}/retest`).send(retestBody());

    // restart: the re-test is closed, then a NEW re-test starts on the same row
    const app2 = await open(repo, () => second);
    await boot(app2);
    expect(
      (await api(app2).post(`${BASE}/${id}/retest`).send(retestBody())).status,
    ).toBe(202);
    const runB = repo.rows.get(id)!.runId;
    expect(repo.rows.get(id)!.status).toBe('running');

    // the old (zombie) re-test finishes: it must not touch the new one
    zombie.release();
    await waitFor(() => repo.refused >= 1, 'the zombie write to be refused');
    await waitFor(() => zombie.users.size === 0, 'the zombie cleanup');
    expect(repo.rows.get(id)!.runId).toBe(runB);
    expect(repo.rows.get(id)!.status).toBe('running');
    expect(repo.rows.get(id)!.record.lastRetest?.status).toBe('running');

    // the new re-test finishes normally
    second.release();
    const done = await waitUntilDone(app2, id);
    expect(done.body.status).toBe('completed');
    expect(done.body.lastRetest.status).toBe('completed');
  });

  it('a runner told to stop throws RUN_STOPPED and still cleans up', async () => {
    const fake = new FakeGateway(demoTables());
    let asked = 0;
    // 1st question (before users): go on. 2nd (first table): stop.
    const shouldStop = () => ++asked > 1;
    const error = await runProver(fake, undefined, undefined, shouldStop).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProverError);
    expect((error as ProverError).code).toBe('RUN_STOPPED');
    expect((error as ProverError).cleanup).toBe('ok');
    expect(fake.users.size).toBe(0);
    for (const rows of fake.data.values()) expect(rows).toHaveLength(0);
  });

  // a failed final write
  it('when the final write fails, GET answers from the run itself and the write is retried', async () => {
    const repo = new InMemoryAuditRepository();
    const app = await open(repo, () => new FakeGateway(safeTables()));
    repo.failAlways('finish');
    const id = (await api(app).post(BASE).send(validBody())).body.id as string;
    // the run is over, but the store still says running (the write failed)
    await waitFor(
      () => repo.calls.filter((c) => c === 'finish').length >= 2,
      'a retry',
    );
    expect(repo.rows.get(id)!.status).toBe('running');
    const res = await api(app).get(`${BASE}/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.cleanup).toBe('ok');
    // findings and the certificate come from the run too
    expect(
      (await api(app).get(`${BASE}/${id}/findings`)).body.findings,
    ).toHaveLength(1);
    expect((await api(app).get(`${BASE}/${id}/certificate`)).status).toBe(200);

    // the store comes back: the background retry saves the final state
    repo.failNext('finish', 0);
    await waitFor(
      () => repo.rows.get(id)!.status === 'completed',
      'the retry to succeed',
    );
    expect((await api(app).get(`${BASE}/${id}`)).body).toEqual(res.body);
  });

  it('a run record is used only while the store row is still that run', async () => {
    const repo = new InMemoryAuditRepository();
    const app = await open(repo, () => new FakeGateway(safeTables()));
    repo.failAlways('finish');
    const id = (await api(app).post(BASE).send(validBody())).body.id as string;
    await waitFor(
      () => repo.calls.filter((c) => c === 'finish').length >= 1,
      'the first attempt',
    );
    // someone else took the row over (a different run id)
    repo.rows.get(id)!.runId = 'run_someone_else';
    repo.rows.get(id)!.record.progress = 7;
    const res = await api(app).get(`${BASE}/${id}`);
    expect(res.body.modules[0].progress).toBe(7);
  });

  it('while the store is down for a plain read, GET gives a normal error (no keys)', async () => {
    const repo = new InMemoryAuditRepository();
    const app = await open(repo, () => new FakeGateway(safeTables()));
    repo.failNext('get', 1);
    const res = await api(app).get(`${BASE}/aud_anything`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side.',
      },
    });
  });

  // progress writes are throttled
  it('saves progress rarely: many progress steps, only a few writes', async () => {
    const repo = new InMemoryAuditRepository();
    const many: FakeTable[] = Array.from({ length: 20 }, (_, i) => ({
      name: `t${i}`,
      policy: 'own' as const,
      ownerColumn: 'user_id',
    }));
    // every request takes a moment, so the 20 progress steps are spread out
    class SlowGateway extends FakeGateway {
      override async restCall(
        ...args: Parameters<FakeGateway['restCall']>
      ): ReturnType<FakeGateway['restCall']> {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return super.restCall(...args);
      }
    }
    const app = await open(repo, () => new SlowGateway(many), {
      flushMs: 150,
      retryBaseMs: 5,
      retryMaxMs: 20,
    });
    const started = Date.now();
    const id = (await api(app).post(BASE).send(validBody())).body.id as string;
    const done = await waitUntilDone(app, id);
    expect(done.body.status).toBe('completed');
    const writes = repo.calls.filter((c) => c === 'writeRunning').length;
    const seconds = (Date.now() - started) / 150;
    // 20+ progress steps, but at most one write per 150 ms (plus a little slack)
    expect(writes).toBeGreaterThan(0);
    expect(writes).toBeLessThanOrEqual(Math.ceil(seconds) + 2);
    expect(writes).toBeLessThan(12);
    // the final state is always written
    expect(repo.rows.get(id)!.record.progress).toBe(100);
  });

  // "newest 50" and "one at a time"
  it('keeps the newest 50 audits and never removes the running one', async () => {
    const repo = new InMemoryAuditRepository();
    for (let n = 0; n < 55; n++) {
      const createdAt = new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString();
      const id = `aud_old_${String(n).padStart(2, '0')}`;
      await repo.insert({
        id,
        status: 'running',
        createdAt,
        runId: `run_${n}`,
        record: sampleRecord(id, createdAt),
      });
      await repo.finish(
        id,
        `run_${n}`,
        'completed',
        sampleRecord(id, createdAt),
      );
    }
    const gate = new GatedGateway(demoTables());
    const app = await open(repo, () => gate);
    const id = (await api(app).post(BASE).send(validBody())).body.id as string;
    expect(repo.rows.size).toBe(50);
    expect(repo.rows.has(id)).toBe(true);
    expect(repo.rows.has('aud_old_00')).toBe(false);
    expect(repo.rows.has('aud_old_54')).toBe(true);
    // one at a time (in this process)
    const second = await api(app).post(BASE).send(validBody());
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('AUDIT_IN_PROGRESS');
    gate.release();
    await waitUntilDone(app, id);
  });

  it('"approve fix" is saved in the store, and survives a restart', async () => {
    const repo = new InMemoryAuditRepository();
    const app1 = await open(repo, () => new FakeGateway(demoTables()));
    const id = (await api(app1).post(BASE).send(validBody())).body.id as string;
    await waitUntilDone(app1, id);
    const findings = (await api(app1).get(`${BASE}/${id}/findings`)).body
      .findings as {
      id: string;
      fix: unknown;
    }[];
    const leaked = findings.find((f) => f.fix)!;
    const res = await api(app1).post(
      `${BASE}/${id}/findings/${leaked.id}/fix/approve`,
    );
    expect(res.status).toBe(200);
    expect(res.body.fix.status).toBe('approved');
    const app2 = await open(repo, () => new FakeGateway(demoTables()));
    await boot(app2);
    const after = (await api(app2).get(`${BASE}/${id}/findings`)).body
      .findings as {
      id: string;
      fix: { status: string } | null;
    }[];
    expect(after.find((f) => f.id === leaked.id)!.fix!.status).toBe('approved');
  });

  // (e) no field is renamed or removed
  it('(e) GET /audits/:id keeps every field of the contract', async () => {
    const repo = new InMemoryAuditRepository();
    const app = await open(repo, () => new FakeGateway(demoTables()));
    const id = (await api(app).post(BASE).send(validBody())).body.id as string;
    const done = await waitUntilDone(app, id);
    // the keys that GET /audits/:id had before the audit store existed
    expect(Object.keys(done.body).sort()).toEqual(
      [
        'cleanup',
        'createdAt',
        'id',
        'lastRetest',
        'modules',
        'status',
        'summary',
        'target',
      ].sort(),
    );
    expect(Object.keys(done.body.modules[0]).sort()).toEqual(
      ['id', 'name', 'progress', 'status'].sort(),
    );
    expect(Object.keys(done.body.target).sort()).toEqual([
      'label',
      'projectUrl',
    ]);
    expect(Object.keys(done.body.summary).sort()).toEqual(
      ['blocked', 'inconclusive', 'leaked'].sort(),
    );
    // the stored row has no run id inside the record, and the response has none
    expect(JSON.stringify(done.body)).not.toContain('run_');
    expect('runId' in repo.rows.get(id)!.record).toBe(false);
  });

  // keys are never stored
  it('never stores a key, even when an error text quotes it', async () => {
    const repo = new InMemoryAuditRepository(['PLATFORM-KEY-VALUE-7e6d5c']);
    class LeakyGateway extends FakeGateway {
      override fetchOpenApi(): Promise<unknown> {
        return Promise.reject(
          new Error(
            `failed for ${SECRET} and ${PUBLISHABLE} and PLATFORM-KEY-VALUE-7e6d5c`,
          ),
        );
      }
    }
    const app = await open(repo, () => new LeakyGateway(demoTables()));
    const id = (await api(app).post(BASE).send(validBody())).body.id as string;
    const done = await waitUntilDone(app, id);
    expect(done.body.status).toBe('failed');
    const stored = JSON.stringify([...repo.rows.values()]);
    for (const value of [SECRET, PUBLISHABLE, 'PLATFORM-KEY-VALUE-7e6d5c']) {
      expect(stored).not.toContain(value);
    }
    expect(JSON.stringify(done.body)).not.toContain(SECRET);
  });

  it('redacts a key that reaches a finding through reasonDetail', async () => {
    const repo = new InMemoryAuditRepository();
    const tables: FakeTable[] = [
      {
        name: 'bookings',
        policy: 'off',
        ownerColumn: 'user_id',
        insertError: `insert refused, key ${SECRET}`,
      },
    ];
    const app = await open(repo, () => new FakeGateway(tables));
    const id = (await api(app).post(BASE).send(validBody())).body.id as string;
    await waitUntilDone(app, id);
    const stored = JSON.stringify([...repo.rows.values()]);
    expect(stored).not.toContain(SECRET);
    expect(stored).toContain('[REDACTED]');
    const findings = JSON.stringify(
      (await api(app).get(`${BASE}/${id}/findings`)).body,
    );
    expect(findings).not.toContain(SECRET);
  });
});

describe('start-up: the audit store must work', () => {
  it('bootCheck throws when the store cannot be reached (and the message has no address)', async () => {
    const repo = new InMemoryAuditRepository();
    const app = await buildApp(repo, () => new FakeGateway(safeTables()));
    try {
      repo.failNext('ping', 1);
      await expect(boot(app)).rejects.toThrow(/audit store could not be used/);
    } finally {
      await app.close();
    }
  });

  it('does not start without the platform settings, and the message names variables only', async () => {
    const saved = {
      url: process.env.PLATFORM_SUPABASE_URL,
      key: process.env.PLATFORM_SUPABASE_SERVICE_KEY,
    };
    delete process.env.PLATFORM_SUPABASE_URL;
    delete process.env.PLATFORM_SUPABASE_SERVICE_KEY;
    try {
      await expect(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(GATEWAY_FACTORY)
          .useValue(() => new FakeGateway(safeTables()))
          .overrideProvider(ACCESS_CONFIG)
          .useValue({ mode: 'open' })
          .compile(),
      ).rejects.toThrow(
        /PLATFORM_SUPABASE_URL and PLATFORM_SUPABASE_SERVICE_KEY are not set/,
      );
    } finally {
      if (saved.url !== undefined)
        process.env.PLATFORM_SUPABASE_URL = saved.url;
      if (saved.key !== undefined)
        process.env.PLATFORM_SUPABASE_SERVICE_KEY = saved.key;
    }
  });

  it('resolvePlatformConfig names only the variable that is missing or wrong', () => {
    expect(() => resolvePlatformConfig({})).toThrow(
      /PLATFORM_SUPABASE_URL and PLATFORM_SUPABASE_SERVICE_KEY are not set/,
    );
    expect(() =>
      resolvePlatformConfig({ PLATFORM_SUPABASE_URL: 'https://x.supabase.co' }),
    ).toThrow(/^PLATFORM_SUPABASE_SERVICE_KEY is not set/);
    expect(() =>
      resolvePlatformConfig({
        PLATFORM_SUPABASE_URL: 'not a url SECRET-PLACEHOLDER-123',
        PLATFORM_SUPABASE_SERVICE_KEY: 'k'.repeat(20),
      }),
    ).toThrow(/^PLATFORM_SUPABASE_URL must be a valid web address\.$/);
    expect(
      resolvePlatformConfig({
        PLATFORM_SUPABASE_URL: ' https://x.supabase.co/ ',
        PLATFORM_SUPABASE_SERVICE_KEY: ' key-value-123 ',
      }),
    ).toEqual({ url: 'https://x.supabase.co', serviceKey: 'key-value-123' });
  });
});
