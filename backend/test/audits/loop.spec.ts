import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import {
  GATEWAY_FACTORY,
  type GatewayFactory,
} from '../../src/audits/audits.service.js';
import type { Gateway } from '../../src/prover/gateway.js';
import type { ProverConfig } from '../../src/prover/types.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';

// Made-up values that are easy to search for. They are not real keys.
const PUB1 = 'PUBLISHABLE-KEY-ONE-9f8e7d';
const SEC1 = 'SECRET-KEY-ONE-1a2b3c';
const PUB2 = 'PUBLISHABLE-KEY-TWO-5c4d3e';
const SEC2 = 'SECRET-KEY-TWO-7e6f5a';
const URL1 = 'https://abcdefghijklmnopqrst.supabase.co';

const startBody = () => ({
  label: 'Demo project',
  projectUrl: URL1,
  anonKey: PUB1,
  serviceKey: SEC1,
  confirmTestProject: true,
});
const retestBody = () => ({
  anonKey: PUB2,
  serviceKey: SEC2,
  confirmTestProject: true,
});

const demoTables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
  { name: 'hotels', policy: 'public-read', ownerColumn: null },
];

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

/** A fake project that cannot be reached; the message quotes the key (worst case). */
class BrokenGateway extends FakeGateway {
  constructor(private readonly quoted: string) {
    super([]);
  }
  override fetchOpenApi(): Promise<unknown> {
    return Promise.reject(new Error(`login failed for key ${this.quoted}`));
  }
}

type Run = (config: ProverConfig) => Gateway;

/**
 * Hands out one gateway per run, in order, and remembers the config each run
 * was given. A run that is not listed fails the test.
 */
function scripted(runs: Run[]) {
  const configs: ProverConfig[] = [];
  const factory: GatewayFactory = (config) => {
    configs.push(config);
    const next = runs.shift();
    if (!next) throw new Error('unexpected extra run');
    return next(config);
  };
  return { factory, configs };
}

async function buildApp(
  factory: GatewayFactory,
  quietLogs = true,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(factory)
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'open' })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(quietLogs ? false : new ConsoleLogger());
  configureApp(app, {});
  await app.init();
  return app;
}

const api = (app: INestApplication) => request(app.getHttpServer());
const BASE = '/api/v1/audits';

async function waitUntilDone(app: INestApplication, id: string) {
  for (let i = 0; i < 400; i++) {
    const res = await api(app).get(`${BASE}/${id}`);
    if (res.body.status !== 'running') return res;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('run did not finish in time');
}

const findingsOf = async (app: INestApplication, id: string) =>
  (await api(app).get(`${BASE}/${id}/findings`)).body.findings as Array<
    Record<string, any>
  >;
const byTable = (list: Array<Record<string, any>>, table: string) =>
  list.find((f) => f.table === table)!;

/** Starts an audit and waits for it. Returns its id. */
async function auditDone(app: INestApplication): Promise<string> {
  const created = await api(app).post(BASE).send(startBody());
  expect(created.status).toBe(202);
  const done = await waitUntilDone(app, created.body.id);
  expect(done.body.status).toBe('completed');
  return created.body.id as string;
}

const retest = (
  app: INestApplication,
  id: string,
  body: unknown = retestBody(),
) =>
  api(app)
    .post(`${BASE}/${id}/retest`)
    .send(body as object);
const approve = (app: INestApplication, id: string, findingId: string) =>
  api(app).post(`${BASE}/${id}/findings/${findingId}/fix/approve`);

describe('Approve fix', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('answers 200 with the updated finding, and only that finding changes', async () => {
    app = await buildApp(
      scripted([() => new FakeGateway(demoTables())]).factory,
    );
    const id = await auditDone(app);
    const before = await findingsOf(app, id);
    const bookings = byTable(before, 'bookings');
    expect(bookings.fix.status).toBe('proposed');

    const res = await approve(app, id, bookings.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(bookings.id);
    expect(res.body.fix.status).toBe('approved');
    expect(res.body.fix.sql).toBe(bookings.fix.sql);

    const after = await findingsOf(app, id);
    expect(byTable(after, 'bookings').fix.status).toBe('approved');
    expect(byTable(after, 'profiles')).toEqual(byTable(before, 'profiles'));
    expect(byTable(after, 'hotels')).toEqual(byTable(before, 'hotels'));
  });

  it('answers 200 again when the fix is already approved', async () => {
    app = await buildApp(
      scripted([() => new FakeGateway(demoTables())]).factory,
    );
    const id = await auditDone(app);
    const fid = byTable(await findingsOf(app, id), 'bookings').id;
    const first = await approve(app, id, fid);
    const second = await approve(app, id, fid);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('answers 404 NOT_FOUND for an unknown audit or an unknown finding', async () => {
    app = await buildApp(
      scripted([() => new FakeGateway(demoTables())]).factory,
    );
    const noAudit = await approve(app, 'aud_nope', 'fnd_001');
    expect(noAudit.status).toBe(404);
    expect(noAudit.body.error.code).toBe('NOT_FOUND');
    const id = await auditDone(app);
    const noFinding = await approve(app, id, 'fnd_999');
    expect(noFinding.status).toBe(404);
    expect(noFinding.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 409 NO_FIX_TO_APPROVE for a BLOCKED or INCONCLUSIVE finding', async () => {
    app = await buildApp(
      scripted([() => new FakeGateway(demoTables())]).factory,
    );
    const id = await auditDone(app);
    const list = await findingsOf(app, id);
    for (const table of ['profiles', 'hotels']) {
      const res = await approve(app, id, byTable(list, table).id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_FIX_TO_APPROVE');
    }
  });

  it('answers 409 AUDIT_IN_PROGRESS while the audit is still running', async () => {
    const fake = new GatedGateway(demoTables());
    app = await buildApp(scripted([() => fake]).factory);
    const created = await api(app).post(BASE).send(startBody());
    const res = await approve(app, created.body.id, 'fnd_001');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUDIT_IN_PROGRESS');
    fake.release();
    await waitUntilDone(app, created.body.id);
  });

  it('can be approved before the Re-test (the backend cannot know if the SQL was run)', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([() => new FakeGateway(tables), () => new FakeGateway(tables)])
        .factory,
    );
    const id = await auditDone(app);
    const fid = byTable(await findingsOf(app, id), 'bookings').id;
    expect((await approve(app, id, fid)).status).toBe(200);
    expect((await retest(app, id)).status).toBe(202);
    await waitUntilDone(app, id);
  });
});

describe('Re-test: input and refusals', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it("rejects projectUrl with 400, even the audit's own address, and runs nothing", async () => {
    const s = scripted([() => new FakeGateway(demoTables())]);
    app = await buildApp(s.factory);
    const id = await auditDone(app);
    for (const projectUrl of [URL1, 'https://other.supabase.co', '', null]) {
      const res = await retest(app, id, { ...retestBody(), projectUrl });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
      expect(JSON.stringify(res.body)).not.toContain(PUB2);
      expect(JSON.stringify(res.body)).not.toContain(SEC2);
    }
    expect(s.configs).toHaveLength(1); // only the first audit ever ran
    const status = await api(app).get(`${BASE}/${id}`);
    expect(status.body.status).toBe('completed');
    expect(status.body.lastRetest).toBeNull();
  });

  it('rejects a missing confirmation, missing keys and a body that is not an object', async () => {
    const s = scripted([() => new FakeGateway(demoTables())]);
    app = await buildApp(s.factory);
    const id = await auditDone(app);
    const bad: unknown[] = [
      { ...retestBody(), confirmTestProject: 'true' },
      { ...retestBody(), confirmTestProject: undefined },
      { anonKey: PUB2, confirmTestProject: true },
      { serviceKey: SEC2, confirmTestProject: true },
      { ...retestBody(), anonKey: '' },
      [],
      'text',
    ];
    for (const body of bad) {
      const res = await retest(app, id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
    }
    expect(s.configs).toHaveLength(1);
  });

  it('answers 404 NOT_FOUND for an unknown audit', async () => {
    app = await buildApp(scripted([]).factory);
    const res = await retest(app, 'aud_nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 409 AUDIT_IN_PROGRESS while the audit, or another audit, runs', async () => {
    const gated = new GatedGateway(demoTables());
    const s = scripted([() => new FakeGateway(demoTables()), () => gated]);
    app = await buildApp(s.factory);
    const first = await auditDone(app);
    // this audit is re-testing
    expect((await retest(app, first)).status).toBe(202);
    const again = await retest(app, first);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('AUDIT_IN_PROGRESS');
    expect(s.configs).toHaveLength(2);
    gated.release();
    await waitUntilDone(app, first);
  });

  it('answers 409 NOT_ELIGIBLE for an audit that failed (no findings to re-test)', async () => {
    const s = scripted([() => new FakeGateway([])]); // no tables: the audit fails
    app = await buildApp(s.factory);
    const created = await api(app).post(BASE).send(startBody());
    const done = await waitUntilDone(app, created.body.id);
    expect(done.body.status).toBe('failed');
    const res = await retest(app, created.body.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
    expect(s.configs).toHaveLength(1);
  });
});

describe('Re-test: the loop LEAKED, fix, re-test, BLOCKED', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('turns the leaked table BLOCKED, with the same id, and uses the stored address and the new keys', async () => {
    const tables = demoTables();
    const s = scripted([
      () => new FakeGateway(tables),
      () => new FakeGateway(tables),
    ]);
    app = await buildApp(s.factory);
    const id = await auditDone(app);
    const first = await findingsOf(app, id);
    expect(byTable(first, 'bookings').verdict).toBe('LEAKED');
    expect(byTable(first, 'bookings').retest).toEqual({
      status: 'not_run',
      lastRunAt: null,
      previousVerdict: null,
    });
    await approve(app, id, byTable(first, 'bookings').id);

    // the user runs the SQL in their own project
    tables[0].policy = 'own';

    const res = await retest(app, id);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id, status: 'running' });
    const done = await waitUntilDone(app, id);

    // the run used the address saved with the audit and the keys of this request
    expect(s.configs[1]).toEqual({
      supabaseUrl: URL1,
      publishableKey: PUB2,
      secretKey: SEC2,
    });

    expect(done.body.status).toBe('completed');
    expect(done.body.error).toBeUndefined();
    expect(done.body.cleanup).toBe('ok');
    expect(done.body.summary).toEqual({
      leaked: 0,
      blocked: 2,
      inconclusive: 1,
    });
    expect(done.body.lastRetest).toMatchObject({
      status: 'completed',
      tablesAdded: [],
      tablesRemoved: [],
      error: null,
    });
    expect(done.body.lastRetest.finishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const after = await findingsOf(app, id);
    const bookings = byTable(after, 'bookings');
    expect(bookings.id).toBe(byTable(first, 'bookings').id);
    expect(bookings.verdict).toBe('BLOCKED');
    expect(bookings.fix).toBeNull();
    expect(bookings.retest.status).toBe('passed');
    expect(bookings.retest.previousVerdict).toBe('LEAKED');
    expect(bookings.retest.lastRunAt).toBe(done.body.lastRetest.finishedAt);
    // the others were not LEAKED before, so "not_run"
    expect(byTable(after, 'profiles').retest.status).toBe('not_run');
    expect(byTable(after, 'profiles').retest.previousVerdict).toBe('BLOCKED');
    expect(byTable(after, 'hotels').retest.status).toBe('not_run');
    expect(byTable(after, 'hotels').retest.previousVerdict).toBe(
      'INCONCLUSIVE',
    );
  });

  it('keeps failed, and the approved fix, when the table still leaks the same way', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([() => new FakeGateway(tables), () => new FakeGateway(tables)])
        .factory,
    );
    const id = await auditDone(app);
    const fid = byTable(await findingsOf(app, id), 'bookings').id;
    await approve(app, id, fid);
    await retest(app, id); // nothing was fixed
    const done = await waitUntilDone(app, id);
    expect(done.body.summary.leaked).toBe(1);
    const bookings = byTable(await findingsOf(app, id), 'bookings');
    expect(bookings.verdict).toBe('LEAKED');
    expect(bookings.retest.status).toBe('failed');
    expect(bookings.retest.previousVerdict).toBe('LEAKED');
    expect(bookings.fix.status).toBe('approved'); // same SQL: the approval stays
  });

  it('goes back to "proposed" when the new proposal has different SQL', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([() => new FakeGateway(tables), () => new FakeGateway(tables)])
        .factory,
    );
    const id = await auditDone(app);
    const before = byTable(await findingsOf(app, id), 'bookings');
    await approve(app, id, before.id);
    tables[0].policy = 'public-read'; // now only reading leaks
    await retest(app, id);
    await waitUntilDone(app, id);
    const bookings = byTable(await findingsOf(app, id), 'bookings');
    expect(bookings.verdict).toBe('LEAKED');
    expect(bookings.fix.sql).not.toBe(before.fix.sql);
    expect(bookings.fix.status).toBe('proposed');
  });

  it('shows the old findings as "running" during the re-test and swaps in the new ones at the end', async () => {
    const tables = demoTables();
    const gated = new GatedGateway(tables);
    app = await buildApp(
      scripted([() => new FakeGateway(tables), () => gated]).factory,
    );
    const id = await auditDone(app);
    const old = await findingsOf(app, id);
    tables[0].policy = 'own';

    await retest(app, id);
    const mid = await api(app).get(`${BASE}/${id}`);
    expect(mid.body.status).toBe('running');
    expect(mid.body.modules[0].status).toBe('running');
    expect(mid.body.lastRetest.status).toBe('running');
    expect(mid.body.lastRetest.finishedAt).toBeNull();
    // the summary still describes the old findings
    expect(mid.body.summary).toEqual({
      leaked: 1,
      blocked: 1,
      inconclusive: 1,
    });

    const during = await findingsOf(app, id);
    expect(during).toHaveLength(3);
    expect(during.map((f) => f.verdict)).toEqual(old.map((f) => f.verdict));
    expect(during.every((f) => f.retest.status === 'running')).toBe(true);
    expect(byTable(during, 'bookings').verdict).toBe('LEAKED'); // not half-new

    gated.release();
    await waitUntilDone(app, id);
    const now = await findingsOf(app, id);
    expect(byTable(now, 'bookings').verdict).toBe('BLOCKED');
    expect(now.some((f) => f.retest.status === 'running')).toBe(false);
  });

  it('adds and drops tables: ids are kept, new ones are new, a dropped id is never reused', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([
        () => new FakeGateway(tables),
        () => new FakeGateway(tables),
        () => new FakeGateway(tables),
      ]).factory,
    );
    const id = await auditDone(app);
    const first = await findingsOf(app, id);
    expect(byTable(first, 'hotels').id).toBe('fnd_003');

    tables.splice(2, 1); // hotels disappears
    tables.push({ name: 'notes', policy: 'off', ownerColumn: 'user_id' });
    await retest(app, id);
    const done = await waitUntilDone(app, id);
    expect(done.body.lastRetest.tablesAdded).toEqual(['notes']);
    expect(done.body.lastRetest.tablesRemoved).toEqual(['hotels']);
    const second = await findingsOf(app, id);
    expect(second.map((f) => f.table).sort()).toEqual([
      'bookings',
      'notes',
      'profiles',
    ]);
    expect(byTable(second, 'bookings').id).toBe(byTable(first, 'bookings').id);
    expect(byTable(second, 'notes').id).toBe('fnd_004');
    expect(byTable(second, 'notes').retest.previousVerdict).toBeNull();
    expect(byTable(second, 'notes').retest.status).toBe('failed'); // new and LEAKED

    tables.push({ name: 'extra', policy: 'own', ownerColumn: 'user_id' });
    await retest(app, id);
    await waitUntilDone(app, id);
    const third = await findingsOf(app, id);
    expect(byTable(third, 'extra').id).toBe('fnd_005'); // fnd_003 is not handed out again
  });
});

describe('Re-test that fails', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('keeps the old findings, does not fail the audit, and can be tried again', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([
        () => new FakeGateway(tables),
        () => new BrokenGateway(SEC2),
        () => new FakeGateway(tables),
      ]).factory,
    );
    const id = await auditDone(app);
    const fid = byTable(await findingsOf(app, id), 'bookings').id;
    await approve(app, id, fid);
    const before = await findingsOf(app, id);
    const statusBefore = (await api(app).get(`${BASE}/${id}`)).body;

    await retest(app, id);
    const failed = await waitUntilDone(app, id);

    expect(failed.body.status).toBe('completed'); // NOT failed
    expect(failed.body.error).toBeUndefined();
    expect(failed.body.modules[0].status).toBe('completed');
    expect(failed.body.lastRetest.status).toBe('failed');
    expect(failed.body.lastRetest.error.code).toBe('PROVER_FAILED');
    expect(failed.body.lastRetest.error.message).toContain('[REDACTED]');
    expect(failed.body.lastRetest.tablesAdded).toEqual([]);
    expect(failed.body.lastRetest.tablesRemoved).toEqual([]);
    expect(JSON.stringify(failed.body)).not.toContain(SEC2);
    expect(failed.body.summary).toEqual(statusBefore.summary);
    expect(failed.body.createdAt).toBe(statusBefore.createdAt);

    // exactly the same findings, including the approval and retest.status
    expect(await findingsOf(app, id)).toEqual(before);

    // the report is usable: approve still works, and Re-test can be pressed again
    expect((await approve(app, id, fid)).status).toBe(200);
    tables[0].policy = 'own';
    expect((await retest(app, id)).status).toBe(202);
    const ok = await waitUntilDone(app, id);
    expect(ok.body.lastRetest.status).toBe('completed');
    expect(ok.body.lastRetest.error).toBeNull();
    expect(byTable(await findingsOf(app, id), 'bookings').verdict).toBe(
      'BLOCKED',
    );
  });

  it('also survives a gateway that cannot even be created', async () => {
    const tables = demoTables();
    let calls = 0;
    const factory: GatewayFactory = () => {
      calls += 1;
      if (calls === 2) throw new Error(`cannot connect with ${SEC2}`);
      return new FakeGateway(tables);
    };
    app = await buildApp(factory);
    const id = await auditDone(app);
    const before = await findingsOf(app, id);
    await retest(app, id);
    const done = await waitUntilDone(app, id);
    expect(done.body.status).toBe('completed');
    expect(done.body.lastRetest.status).toBe('failed');
    expect(JSON.stringify(done.body)).not.toContain(SEC2);
    expect(await findingsOf(app, id)).toEqual(before);
  });
});

describe('Certificate', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  const certificate = (id: string) => api(app).get(`${BASE}/${id}/certificate`);

  it('is issued after the loop, with a stable hash and the agreed shape', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([() => new FakeGateway(tables), () => new FakeGateway(tables)])
        .factory,
    );
    const id = await auditDone(app);
    tables[0].policy = 'own';
    await retest(app, id);
    const done = await waitUntilDone(app, id);

    const res = await certificate(id);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'auditId',
        'checksRun',
        'disclaimer',
        'issuedAt',
        'recordHash',
        'result',
        'summary',
      ].sort(),
    );
    expect(res.body.auditId).toBe(id);
    expect(res.body.result).toBe('NO_LEAK_FOUND_BY_THESE_CHECKS');
    expect(res.body.checksRun).toEqual(['data-access-prover']);
    expect(res.body.summary).toEqual({ blocked: 2, inconclusive: 1 });
    expect(res.body.disclaimer).toBe(
      'This is evidence that specific checks passed. It is not a guarantee that the app is secure.',
    );
    expect(res.body.issuedAt).toBe(done.body.lastRetest.finishedAt);
    expect(res.body.recordHash).toMatch(/^[0-9a-f]{64}$/);

    // the same on every request
    const again = await certificate(id);
    expect(again.body).toEqual(res.body);
    // other routes do not change the record
    await api(app).get(`${BASE}/${id}/findings`);
    expect((await certificate(id)).body.recordHash).toBe(res.body.recordHash);
  });

  it('gets a new hash and time after a new re-test', async () => {
    const tables = demoTables();
    tables[0].policy = 'own';
    app = await buildApp(
      scripted([() => new FakeGateway(tables), () => new FakeGateway(tables)])
        .factory,
    );
    const id = await auditDone(app);
    const one = (await certificate(id)).body;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await retest(app, id);
    await waitUntilDone(app, id);
    const two = (await certificate(id)).body;
    expect(two.issuedAt).not.toBe(one.issuedAt);
    expect(two.recordHash).not.toBe(one.recordHash);
  });

  it('can be issued for an audit with no leak at all (no re-test needed)', async () => {
    app = await buildApp(
      scripted([
        () =>
          new FakeGateway([
            { name: 'profiles', policy: 'own', ownerColumn: 'id' },
          ]),
      ]).factory,
    );
    const id = await auditDone(app);
    const res = await certificate(id);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ blocked: 1, inconclusive: 0 });
  });

  it('answers 409 NOT_ELIGIBLE while a leak remains', async () => {
    app = await buildApp(
      scripted([() => new FakeGateway(demoTables())]).factory,
    );
    const id = await auditDone(app);
    const res = await certificate(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
    expect(res.body.error.message).toMatch(/leak/i);
  });

  it('answers 409 when the leak is still there after a re-test', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([() => new FakeGateway(tables), () => new FakeGateway(tables)])
        .factory,
    );
    const id = await auditDone(app);
    await retest(app, id);
    await waitUntilDone(app, id);
    expect((await certificate(id)).status).toBe(409);
  });

  it('answers 409 for an audit with only INCONCLUSIVE findings', async () => {
    app = await buildApp(
      scripted([
        () =>
          new FakeGateway([
            { name: 'hotels', policy: 'public-read', ownerColumn: null },
          ]),
      ]).factory,
    );
    const id = await auditDone(app);
    const res = await certificate(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('answers 409 when the cleanup failed', async () => {
    app = await buildApp(
      scripted([
        () =>
          new FakeGateway(
            [{ name: 'profiles', policy: 'own', ownerColumn: 'id' }],
            { failDeleteUser: true },
          ),
      ]).factory,
    );
    const id = await auditDone(app);
    const status = (await api(app).get(`${BASE}/${id}`)).body;
    expect(status.cleanup).toBe('failed');
    expect(status.summary.blocked).toBe(1);
    const res = await certificate(id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/removed/i);
  });

  it('answers 409 while running (audit and re-test) and for a failed audit', async () => {
    const gated = new GatedGateway(demoTables());
    app = await buildApp(
      scripted([
        () =>
          new FakeGateway([{ name: 'p', policy: 'own', ownerColumn: 'id' }]),
        () => gated,
        () => new FakeGateway([]),
      ]).factory,
    );
    const id = await auditDone(app);
    expect((await certificate(id)).status).toBe(200);
    await retest(app, id);
    const mid = await certificate(id);
    expect(mid.status).toBe(409);
    expect(mid.body.error.message).toMatch(/running/i);
    gated.release();
    await waitUntilDone(app, id);

    const failedCreated = await api(app).post(BASE).send(startBody());
    const failed = await waitUntilDone(app, failedCreated.body.id);
    expect(failed.body.status).toBe('failed');
    expect((await certificate(failedCreated.body.id)).status).toBe(409);
  });

  it('answers 404 NOT_FOUND for an unknown audit', async () => {
    app = await buildApp(scripted([]).factory);
    const res = await api(app).get(`${BASE}/aud_nope/certificate`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('never calls the result certified, and says "no leak found by these checks"', async () => {
    app = await buildApp(
      scripted([
        () =>
          new FakeGateway([{ name: 'p', policy: 'own', ownerColumn: 'id' }]),
      ]).factory,
    );
    const id = await auditDone(app);
    const body = (await certificate(id)).body;
    const withoutDisclaimer = JSON.stringify({ ...body, disclaimer: '' });
    expect(withoutDisclaimer).not.toMatch(/secure|safe|certified/i);
    expect(body.disclaimer).toMatch(/not a guarantee/);
  });
});

describe('After a restart', () => {
  it('answers 404 NOT_FOUND on all three routes for an id from before', async () => {
    const tables = demoTables();
    const one = await buildApp(
      scripted([() => new FakeGateway(tables)]).factory,
    );
    const id = await auditDone(one);
    const fid = byTable(await findingsOf(one, id), 'bookings').id;
    await one.close();

    const two = await buildApp(scripted([]).factory); // a fresh server, empty memory
    try {
      expect((await approve(two, id, fid)).status).toBe(404);
      expect((await retest(two, id)).status).toBe(404);
      expect((await api(two).get(`${BASE}/${id}/certificate`)).status).toBe(
        404,
      );
    } finally {
      await two.close();
    }
  });
});

describe('Keys in the re-test are write-only', () => {
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

  it('never shows a re-test key in any response or log line, also when the run fails', async () => {
    const tables = demoTables();
    app = await buildApp(
      scripted([
        () => new FakeGateway(tables),
        () => new FakeGateway(tables),
        () => new BrokenGateway(SEC2),
      ]).factory,
      false, // logs ON, so the log lines can be checked
    );
    const id = await auditDone(app);
    const texts: string[] = [];
    const record = (r: { body: unknown }) => texts.push(JSON.stringify(r.body));

    const fid = byTable(await findingsOf(app, id), 'bookings').id;
    record(await approve(app, id, fid));
    record(await retest(app, id)); // 202
    record(await waitUntilDone(app, id));
    record(await retest(app, id, { ...retestBody(), projectUrl: URL1 })); // 400
    record(await retest(app, id)); // runs and fails
    record(await waitUntilDone(app, id));
    record(await api(app).get(`${BASE}/${id}/findings`));
    record(await api(app).get(`${BASE}/${id}/certificate`));

    const all = texts.join('\n');
    expect(written.join('')).toContain('re-test'); // logging really happened
    for (const key of [PUB1, SEC1, PUB2, SEC2]) {
      expect(all).not.toContain(key);
      expect(written.join('')).not.toContain(key);
    }
  });
});
