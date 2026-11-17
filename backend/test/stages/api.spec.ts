import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AUDIT_REPOSITORY } from '../../src/audits/audit-repository.js';
import {
  AuditsService,
  GATEWAY_FACTORY,
  type GatewayFactory,
} from '../../src/audits/audits.service.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';
import { InMemoryAuditRepository } from '../audits/in-memory-audit-repository.js';
import { sampleRecord } from '../audits/repository-contract.js';

// Made-up values that are easy to search for. They are not real keys.
const PUBLISHABLE = 'PUBLISHABLE-KEY-VALUE-9f8e7d';
const SECRET = 'SECRET-KEY-VALUE-1a2b3c';
const BASE = '/api/v1/audits';

const body = () => ({
  label: 'Stages test',
  projectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
});
const retestBody = () => ({
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
});

const safeTables = (): FakeTable[] => [
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
];
const leakyTables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
];

async function buildApp(
  repo: InMemoryAuditRepository,
  factory: GatewayFactory,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(factory)
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(repo)
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'open' })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  configureApp(app, {});
  await app.init();
  return app;
}

const api = (app: INestApplication) => request(app.getHttpServer());

async function waitUntilDone(app: INestApplication, id: string) {
  for (let i = 0; i < 600; i++) {
    const res = await api(app).get(`${BASE}/${id}`);
    if (res.body.status !== 'running') return res;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('audit did not finish in time');
}

describe('stages in the API (additive fields)', () => {
  const apps: INestApplication[] = [];
  const open = async (...args: Parameters<typeof buildApp>) => {
    const app = await buildApp(...args);
    apps.push(app);
    return app;
  };
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  it('GET /audits/:id has schemaVersion, ownership, plan and gate, and keeps every old field', async () => {
    const app = await open(
      new InMemoryAuditRepository(),
      () => new FakeGateway(safeTables()),
    );
    const id = (await api(app).post(BASE).send(body())).body.id as string;
    const res = await waitUntilDone(app, id);
    expect(res.body.status).toBe('completed');

    // the old fields, all still there
    for (const key of [
      'id',
      'status',
      'createdAt',
      'target',
      'summary',
      'modules',
      'cleanup',
      'lastRetest',
    ]) {
      expect(res.body).toHaveProperty(key);
    }
    // the new fields
    expect(res.body.schemaVersion).toBe(2);
    expect(res.body.ownership.status).toBe('skipped');
    expect(res.body.ownership.reason.en).toEqual(expect.any(String));
    expect(res.body.ownership.reason.ur).toEqual(expect.any(String));
    expect(res.body.plan.map((p: { id: string }) => p.id)).toEqual([
      'data-access-prover',
      'tls-headers',
      'bundle-secrets',
      'active-checks',
    ]);
    expect(res.body.plan[0]).toEqual({
      id: 'data-access-prover',
      title: { en: expect.any(String), ur: expect.any(String) },
      mode: 'keyed',
      required: true,
    });
    // nothing more than these 4 new keys
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'cleanup',
        'createdAt',
        'gate',
        'id',
        'lastRetest',
        'modules',
        'ownership',
        'plan',
        'schemaVersion',
        'status',
        'summary',
        'target',
      ].sort(),
    );
    // today the gate can not be ready: the passive inspectors are not built
    expect(res.body.gate.decision).toBe('not_ready');
    expect(res.body.gate.reasons.length).toBeGreaterThan(0);
    // the existing modules array is unchanged
    expect(res.body.modules.map((m: { id: string }) => m.id)).toEqual([
      'data-access-prover',
    ]);
  });

  it('GET /audits/:id/evidence lists the items and the coverage', async () => {
    const app = await open(
      new InMemoryAuditRepository(),
      () => new FakeGateway(leakyTables()),
    );
    const id = (await api(app).post(BASE).send(body())).body.id as string;
    await waitUntilDone(app, id);
    const res = await api(app).get(`${BASE}/${id}/evidence`);
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(2);
    expect(
      res.body.items.map(
        (i: { table: string; verdict: string; proof: string }) => [
          i.table,
          i.verdict,
          i.proof,
        ],
      ),
    ).toEqual([
      ['bookings', 'LEAKED', 'PROVEN'],
      ['profiles', 'BLOCKED', 'PROVEN'],
    ]);
    expect(res.body.coverage.checked).toEqual(['data-access-prover']);
    expect(res.body.coverage.skipped.map((s: { id: string }) => s.id)).toEqual([
      'tls-headers',
      'bundle-secrets',
      'active-checks',
    ]);
    expect(res.body.coverage.outOfScope).toEqual([]);
    expect(res.body.coverage.partial).toEqual([]);
    expect(res.body.coverage.failedToRun).toEqual([]);
    expect(res.body.coverage.limits.map((l: { ur: string }) => l.ur)).toContain(
      'Doosre origin ki scripts scan nahi hotin.',
    );
    // the items point at real findings
    const findings = (await api(app).get(`${BASE}/${id}/findings`)).body
      .findings as { id: string }[];
    for (const item of res.body.items) {
      expect(findings.map((f) => f.id)).toContain(item.findingId);
    }
  });

  it('a leak keeps the gate not_ready and says so', async () => {
    const app = await open(
      new InMemoryAuditRepository(),
      () => new FakeGateway(leakyTables()),
    );
    const id = (await api(app).post(BASE).send(body())).body.id as string;
    const res = await waitUntilDone(app, id);
    expect(res.body.gate.decision).toBe('not_ready');
    expect(
      res.body.gate.reasons.map((r: { en: string }) => r.en).join(' '),
    ).toContain('leak');
  });

  it('an audit whose Prover failed: gate not_ready, the data access check is failedToRun', async () => {
    class Broken extends FakeGateway {
      override fetchOpenApi(): Promise<unknown> {
        return Promise.reject(new Error(`request failed for key ${SECRET}`));
      }
    }
    const app = await open(
      new InMemoryAuditRepository(),
      () => new Broken(safeTables()),
    );
    const id = (await api(app).post(BASE).send(body())).body.id as string;
    const res = await waitUntilDone(app, id);
    expect(res.body.status).toBe('failed');
    expect(res.body.gate.decision).toBe('not_ready');
    const evidence = (await api(app).get(`${BASE}/${id}/evidence`)).body;
    expect(evidence.coverage.checked).toEqual([]);
    expect(
      evidence.coverage.failedToRun.map((c: { id: string }) => c.id),
    ).toEqual(['data-access-prover']);
    // the key is redacted here too
    expect(JSON.stringify(evidence)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('the stage fields survive a restart (they are stored with the audit)', async () => {
    const repo = new InMemoryAuditRepository();
    const app1 = await open(repo, () => new FakeGateway(safeTables()));
    const id = (await api(app1).post(BASE).send(body())).body.id as string;
    const before = await waitUntilDone(app1, id);
    const evidenceBefore = (await api(app1).get(`${BASE}/${id}/evidence`)).body;
    await app1.close();
    const app2 = await open(repo, () => new FakeGateway(safeTables()));
    await app2.get(AuditsService).bootCheck();
    expect((await api(app2).get(`${BASE}/${id}`)).body).toEqual(before.body);
    expect((await api(app2).get(`${BASE}/${id}/evidence`)).body).toEqual(
      evidenceBefore,
    );
  });

  it('a re-test renews the stage fields from the new findings', async () => {
    const app = await open(
      new InMemoryAuditRepository(),
      (() => {
        const runs = [
          new FakeGateway(leakyTables()),
          new FakeGateway(safeTables()),
        ];
        return () => runs.shift()!;
      })(),
    );
    const id = (await api(app).post(BASE).send(body())).body.id as string;
    const first = await waitUntilDone(app, id);
    expect(
      first.body.gate.reasons.map((r: { en: string }) => r.en).join(' '),
    ).toContain('leak');
    expect(
      (await api(app).post(`${BASE}/${id}/retest`).send(retestBody())).status,
    ).toBe(202);
    const second = await waitUntilDone(app, id);
    expect(second.body.lastRetest.status).toBe('completed');
    expect(
      second.body.gate.reasons.map((r: { en: string }) => r.en).join(' '),
    ).not.toContain('leak');
    const items = (await api(app).get(`${BASE}/${id}/evidence`)).body.items as {
      verdict: string;
    }[];
    expect(items.every((i) => i.verdict !== 'LEAKED')).toBe(true);
  });

  it('an audit stored before the stages existed: no new fields, and /evidence is a plain 404', async () => {
    const repo = new InMemoryAuditRepository();
    const record = {
      ...sampleRecord('aud_old00000001', new Date().toISOString()),
      status: 'completed' as const,
      cleanup: 'ok' as const,
    };
    await repo.insert({
      id: record.id,
      status: 'running',
      createdAt: record.createdAt,
      runId: 'run_old',
      record,
    });
    await repo.finish(record.id, 'run_old', 'completed', record);
    const app = await open(repo, () => new FakeGateway(safeTables()));
    const res = await api(app).get(`${BASE}/${record.id}`);
    expect(res.status).toBe(200);
    for (const key of ['schemaVersion', 'ownership', 'plan', 'gate']) {
      expect(res.body).not.toHaveProperty(key);
    }
    const evidence = await api(app).get(`${BASE}/${record.id}/evidence`);
    expect(evidence.status).toBe(404);
    expect(evidence.body.error.code).toBe('NOT_FOUND');
  });

  it('an unknown audit: /evidence is 404 NOT_FOUND like the other routes', async () => {
    const app = await open(
      new InMemoryAuditRepository(),
      () => new FakeGateway(safeTables()),
    );
    const res = await api(app).get(`${BASE}/aud_unknown/evidence`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('never puts a key into the stage fields', async () => {
    const repo = new InMemoryAuditRepository();
    const app = await open(repo, () => new FakeGateway(leakyTables()));
    const id = (await api(app).post(BASE).send(body())).body.id as string;
    const res = await waitUntilDone(app, id);
    const evidence = await api(app).get(`${BASE}/${id}/evidence`);
    const text = JSON.stringify([
      res.body,
      evidence.body,
      [...repo.rows.values()],
    ]);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PUBLISHABLE);
  });
});
