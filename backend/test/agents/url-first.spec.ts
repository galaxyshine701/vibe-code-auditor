import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { AUDIT_REPOSITORY } from '../../src/audits/audit-repository.js';
import { InMemoryAuditRepository } from '../audits/in-memory-audit-repository.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  FakeLlm,
  PUBLISHABLE,
  SECRET,
  demoTables,
  getAudit,
  goodAnswer,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';
import { buildWith } from './scenarios.js';

const ON = { ...AGENTS_OFF, enabled: true };
const SITE = 'https://www.example-shop.com';
const urlBody = (extra: Record<string, unknown> = {}) => ({
  websiteUrl: SITE,
  confirmSiteAccess: true,
  ...extra,
});

type Row = {
  id: string;
  status: string;
  progress: number;
  reason?: { en: string; ur: string };
};
type Reason = { en: string; ur: string };

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const noGateway = () => new FakeGateway(demoTables());

describe('flag on: an audit of a website only', () => {
  it('is accepted, finishes as completed, and has no Supabase part at all', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    expect(res.status).toBe(202);
    const done = await waitUntilDone(app, res.body.id);

    expect(done.body.status).toBe('completed');
    expect(done.body.target).toEqual({
      label: 'www.example-shop.com',
      websiteUrl: SITE,
    });
    expect('projectUrl' in done.body.target).toBe(false);
    expect(done.body.summary).toEqual({
      leaked: 0,
      blocked: 0,
      inconclusive: 0,
    });
    expect(done.body.cleanup).toBeNull();
    const findings = await request(app.getHttpServer()).get(
      `/api/v1/audits/${res.body.id}/findings`,
    );
    expect(findings.body.findings).toEqual([]);
  });

  it('shows the Prover row as skipped (not provided), and the stage rows; no Report row', async () => {
    app = await buildWith(noGateway, ON, new FakeLlm((r) => goodAnswer(r)));
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    const rows = done.body.modules as Row[];
    expect(rows.map((m) => m.id)).toEqual([
      'data-access-prover',
      'planner',
      'ownership',
      'evidence',
      'guide',
    ]);
    const prover = rows[0];
    expect([prover.status, prover.progress]).toEqual(['skipped', 0]);
    expect(prover.reason!.en).toMatch(/^Not provided/);
    expect(prover.reason!.ur.length).toBeGreaterThan(0);
    expect(rows.slice(3).map((m) => m.status)).toEqual([
      'completed',
      'completed',
    ]);
  });

  it('never asks the AI to write about tables that were not tested', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildWith(noGateway, ON, llm);
    const res = await post(app, urlBody());
    await waitUntilDone(app, res.body.id);
    expect(llm.requests).toHaveLength(0);
  });

  it('plan: the Prover is optional, the website checks are required', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    const required = Object.fromEntries(
      (done.body.plan as { id: string; required: boolean }[]).map((c) => [
        c.id,
        c.required,
      ]),
    );
    expect(required).toEqual({
      'data-access-prover': false,
      'tls-headers': true,
      'bundle-secrets': true,
      'active-checks': false,
    });
  });

  it('coverage names the data access check as "Not provided"; the gate is not_ready (the website checks are not built yet)', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    const evidence = (
      await request(app.getHttpServer()).get(
        `/api/v1/audits/${res.body.id}/evidence`,
      )
    ).body as {
      items: unknown[];
      coverage: {
        checked: string[];
        skipped: { id: string; reason: Reason }[];
      };
    };
    expect(evidence.items).toEqual([]);
    const skipped = Object.fromEntries(
      evidence.coverage.skipped.map((s) => [s.id, s.reason]),
    );
    expect(skipped['data-access-prover'].en).toMatch(/^Not provided/);
    expect(evidence.coverage.checked).not.toContain('data-access-prover');

    expect(done.body.gate.decision).toBe('not_ready');
    const reasons = (done.body.gate.reasons as Reason[])
      .map((r) => r.en)
      .join('\n');
    expect(reasons).toContain('Data access');
    expect(reasons).toMatch(/not provided/i);
  });

  it('progress ends at 100 and never goes back', async () => {
    app = await buildWith(noGateway, ON);
    const repo = app.get<InMemoryAuditRepository>(AUDIT_REPOSITORY);
    const res = await post(app, urlBody());
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) {
      const row = repo.rows.get(res.body.id);
      if (row) seen.push(row.record.progress);
      if (row && row.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    await waitUntilDone(app, res.body.id);
    const final = repo.rows.get(res.body.id)!;
    expect(final.record.progress).toBe(100);
    for (let i = 1; i < seen.length; i++)
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('GET /evidence, the certificate and the old rules: no certificate without a BLOCKED table', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    await waitUntilDone(app, res.body.id);
    const cert = await request(app.getHttpServer()).get(
      `/api/v1/audits/${res.body.id}/certificate`,
    );
    expect(cert.status).toBe(409);
    expect(cert.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('a re-test of it is refused for now (409 NOT_ELIGIBLE), whatever the body says', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    await waitUntilDone(app, res.body.id);
    for (const body of [
      {},
      { anonKey: PUBLISHABLE, serviceKey: SECRET, confirmTestProject: true },
    ]) {
      const retest = await post(app, body, `/${res.body.id}/retest`);
      expect(retest.status).toBe(409);
      expect(retest.body.error.code).toBe('NOT_ELIGIBLE');
    }
  });

  it('the next audit can start straight away (runningId is free)', async () => {
    app = await buildWith(noGateway, ON);
    const first = await post(app, urlBody());
    await waitUntilDone(app, first.body.id);
    const second = await post(app, urlBody());
    expect(second.status).toBe(202);
    await waitUntilDone(app, second.body.id);
  });
});

describe('flag on: a half-given Supabase group', () => {
  it('is a 400 that names only the missing field, and nothing is started', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(
      app,
      urlBody({
        confirmTestProject: true,
        projectUrl: validBody().projectUrl,
        anonKey: PUBLISHABLE,
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(res.body.error.message).toContain('serviceKey');
    expect(JSON.stringify(res.body)).not.toContain(PUBLISHABLE);
    // nothing is running: the next valid request is accepted
    const ok = await post(app, urlBody());
    expect(ok.status).toBe(202);
    await waitUntilDone(app, ok.body.id);
  });

  it('website + the whole group: the Prover runs as before, and both are in the target', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody({ ...validBody() }));
    expect(res.status).toBe(202);
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.target.websiteUrl).toBe(SITE);
    expect(done.body.target.projectUrl).toBe(validBody().projectUrl);
    expect(done.body.summary.leaked).toBe(1);
    const required = Object.fromEntries(
      (done.body.plan as { id: string; required: boolean }[]).map((c) => [
        c.id,
        c.required,
      ]),
    );
    expect(required['data-access-prover']).toBe(true);
    expect(required['tls-headers']).toBe(true);
  });
});

describe('flag on: a Supabase-only request (the old shape)', () => {
  const required = (plan: { id: string; required: boolean }[]) =>
    Object.fromEntries(plan.map((c) => [c.id, c.required]));

  it('the Prover stays required; the website checks are "Not provided" and optional', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, validBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(required(done.body.plan)).toEqual({
      'data-access-prover': true,
      'tls-headers': false,
      'bundle-secrets': false,
      'active-checks': false,
    });
    const evidence = (
      await request(app.getHttpServer()).get(
        `/api/v1/audits/${res.body.id}/evidence`,
      )
    ).body as { coverage: { skipped: { id: string; reason: Reason }[] } };
    const skipped = Object.fromEntries(
      evidence.coverage.skipped.map((s) => [s.id, s.reason]),
    );
    expect(skipped['tls-headers'].en).toMatch(/^Not provided/);
    expect(skipped['bundle-secrets'].en).toMatch(/^Not provided/);
  });

  it('a run with a leak is not_ready, and the reasons name the checks that were not provided', async () => {
    app = await buildWith(noGateway, ON);
    const res = await post(app, validBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.gate.decision).toBe('not_ready');
    const text = (done.body.gate.reasons as Reason[])
      .map((r) => r.en)
      .join('\n');
    expect(text).toContain('Certificate and security headers of the site');
    expect(text).toContain('Secret keys inside the scripts of the site');
    expect(text).toMatch(/leak/i);
  });

  it('a run where every table is blocked can now be ready_by_these_checks, with no reasons', async () => {
    app = await buildWith(
      () =>
        new FakeGateway([
          { name: 'bookings', policy: 'own', ownerColumn: 'user_id' },
          { name: 'profiles', policy: 'own', ownerColumn: 'id' },
        ]),
      ON,
    );
    const res = await post(app, validBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.gate).toEqual({
      decision: 'ready_by_these_checks',
      reasons: [],
    });
  });
});

describe('flag off: websiteUrl does not exist', () => {
  it('a websiteUrl without Supabase details is the same 400 as before', async () => {
    app = await buildWith(noGateway, AGENTS_OFF);
    const res = await post(app, urlBody());
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      'Confirm this is a TEST project: set confirmTestProject to true.',
    );
  });

  it('a websiteUrl next to the Supabase details is ignored: the target is the old one', async () => {
    app = await buildWith(noGateway, AGENTS_OFF);
    const res = await post(app, { ...validBody(), websiteUrl: SITE });
    expect(res.status).toBe(202);
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.target).toEqual({
      label: 'Demo project',
      projectUrl: validBody().projectUrl,
    });
    expect(
      JSON.stringify((await getAudit(app, res.body.id)).body),
    ).not.toContain('example-shop');
  });
});
