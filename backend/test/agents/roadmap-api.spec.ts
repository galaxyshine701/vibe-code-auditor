import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { SafeFetchError, type SafeFetchResult } from '../../src/net/safe-fetch.js';
import { InMemoryAuditRepository } from '../audits/in-memory-audit-repository.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  PROJECT_URL,
  PUBLISHABLE,
  SECRET,
  demoTables,
  getAudit,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';
import {
  BANNED_EN,
  BANNED_UR,
  allStrings,
} from '../stages/roadmap-fixtures.js';
import { buildWith } from './scenarios.js';

// Only the network is fake (as in site-flow.spec.ts). Everything else is real.
const site = vi.hoisted(() => ({
  handler: undefined as undefined | ((url: string) => Promise<unknown>),
}));
vi.mock('../../src/net/safe-fetch.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/net/safe-fetch.js')>();
  return {
    ...original,
    safeFetch: (url: string) => {
      if (!site.handler) throw new Error('no fake site');
      return site.handler(url);
    },
  };
});

const WEBSITE = 'https://www.example-shop.com';
const ON = { ...AGENTS_OFF, enabled: true };
const KEY = 'sb_secret_AbCdEfGhIjKlMnOp123456';
const WEAK = { 'x-content-type-options': 'nosniff' };
const answer = (url: string, body: string, headers: Record<string, string> = WEAK): SafeFetchResult => ({
  url,
  status: 200,
  headers,
  body: Buffer.from(body),
});

/** The front page links /a.js?token=abc123; the script holds a secret key. */
function serveLeakySite() {
  site.handler = async (url) => {
    if (url === `${WEBSITE}/` || url === WEBSITE) {
      return answer(`${WEBSITE}/`, '<html><script src="/a.js?token=abc123"></script></html>');
    }
    if (new URL(url).pathname === '/a.js') return answer(url, `var k="${KEY}"`);
    throw new SafeFetchError('NETWORK');
  };
}

const urlBody = () => ({ websiteUrl: WEBSITE, confirmSiteAccess: true });
const bothBody = () => ({ ...validBody(), ...urlBody() });
const retestBody = () => ({ anonKey: PUBLISHABLE, serviceKey: SECRET, confirmTestProject: true });

const roadmapOf = (app: INestApplication, id: string) =>
  request(app.getHttpServer()).get(`/api/v1/audits/${id}/roadmap`);
const reportOf = (app: INestApplication, id: string) =>
  request(app.getHttpServer()).get(`/api/v1/audits/${id}/client-report`);

let app: INestApplication | undefined;
beforeEach(() => {
  site.handler = undefined;
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const demo = () => new FakeGateway(demoTables());

type Item = { id: string; kind: string; severity: string; refs: { checkId: string } };

describe('flag on: GET /audits/:id/roadmap and /client-report', () => {
  it('Supabase only: 200, the roadmap and the client report have their shape', async () => {
    app = await buildWith(demo, ON);
    const res = await post(app, validBody());
    await waitUntilDone(app, res.body.id);

    const roadmap = await roadmapOf(app, res.body.id);
    expect(roadmap.status).toBe(200);
    expect(roadmap.body.schemaVersion).toBe(1);
    expect(roadmap.body.truncated).toBe(0);
    const kinds = (roadmap.body.items as Item[]).map((i) => i.kind);
    expect(kinds).toContain('fix-finding'); // bookings is open
    expect(kinds).toContain('confirm'); // hotels has no owner column
    expect(kinds).toContain('retest');
    expect(kinds).toContain('provide-input'); // no website
    expect((roadmap.body.items as Item[])[0]).toMatchObject({ id: 'rm_001', kind: 'fix-finding', severity: 'critical' });

    const report = await reportOf(app, res.body.id);
    expect(report.status).toBe(200);
    expect(report.body.schemaVersion).toBe(1);
    expect(report.body.decision).toBe('not_ready');
    expect(report.body.findings).toEqual({
      tables: { leaked: 1, blocked: 1, inconclusive: 1 },
      site: null,
    });
    expect(report.body.topActions).toEqual(
      (roadmap.body.items as Item[]).slice(0, 3).map((i) => i.id),
    );
    expect(report.body.headline.en).toContain('by these checks');
  });

  it('URL only: the secret key and the headers; no table counts', async () => {
    serveLeakySite();
    app = await buildWith(demo, ON);
    const res = await post(app, urlBody());
    await waitUntilDone(app, res.body.id);
    const roadmap = await roadmapOf(app, res.body.id);
    const items = roadmap.body.items as Item[];
    expect(items[0]).toMatchObject({ kind: 'fix-site-secret', severity: 'critical' });
    expect(items.some((i) => i.kind === 'improve-header')).toBe(true);
    expect(items.some((i) => i.kind === 'retest')).toBe(false);
    const report = await reportOf(app, res.body.id);
    expect(report.body.findings.tables).toBeNull();
    expect(report.body.findings.site.siteLeaked).toBe(1);
  });

  it('both: tables and site in one report', async () => {
    serveLeakySite();
    app = await buildWith(demo, ON);
    const res = await post(app, bothBody());
    await waitUntilDone(app, res.body.id);
    const report = await reportOf(app, res.body.id);
    expect(report.body.findings.tables).toEqual({ leaked: 1, blocked: 1, inconclusive: 1 });
    expect(report.body.findings.site.siteLeaked).toBe(1);
    expect(report.body.headline.en).toMatch(/1 table/);
    expect(report.body.headline.en).toMatch(/1 secret key/);
  });

  it('no key, no query, no project address, no approval wording in any of the answers', async () => {
    serveLeakySite();
    app = await buildWith(demo, ON);
    const res = await post(app, bothBody());
    await waitUntilDone(app, res.body.id);
    const bodies = [
      (await roadmapOf(app, res.body.id)).body,
      (await reportOf(app, res.body.id)).body,
    ];
    const json = JSON.stringify(bodies);
    for (const secret of [KEY, SECRET, PUBLISHABLE, 'token=abc123', 'abc123', PROJECT_URL, 'canary']) {
      expect(json).not.toContain(secret);
    }
    expect(json).toMatch(/www\.example-shop\.com\/a\.js/); // host and path only
    for (const text of allStrings(bodies)) {
      expect(text).not.toMatch(BANNED_EN);
      expect(text).not.toMatch(BANNED_UR);
    }
  });

  it('GET /audits/:id has nothing new except the "roadmap" row between evidence and guide', async () => {
    app = await buildWith(demo, ON);
    const res = await post(app, validBody());
    const done = await waitUntilDone(app, res.body.id);
    const keys = Object.keys(done.body);
    expect(keys).not.toContain('roadmap');
    expect(keys).not.toContain('clientReport');
    expect(keys).not.toContain('client-report');
    const rows = (done.body.modules as { id: string; status: string }[]).map((m) => m.id);
    expect(rows).toEqual([
      'data-access-prover',
      'planner',
      'ownership',
      'evidence',
      'roadmap',
      'guide',
    ]);
    expect((done.body.modules as { id: string; status: string }[]).find((m) => m.id === 'roadmap')!.status).toBe('completed');
  });

  it('an unknown audit is 404 NOT_FOUND', async () => {
    app = await buildWith(demo, ON);
    for (const path of ['roadmap', 'client-report']) {
      const res = await request(app.getHttpServer()).get(`/api/v1/audits/aud_nope/${path}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('a re-test makes them again: the fixed leak is gone from the roadmap', async () => {
    let call = 0;
    app = await buildWith(
      () =>
        ++call === 1
          ? new FakeGateway(demoTables())
          : new FakeGateway([
              { name: 'bookings', policy: 'own', ownerColumn: 'user_id' },
              { name: 'profiles', policy: 'own', ownerColumn: 'id' },
              { name: 'hotels', policy: 'public-read', ownerColumn: null },
            ]),
      ON,
    );
    const res = await post(app, validBody());
    const id = res.body.id as string;
    await waitUntilDone(app, id);
    const before = (await roadmapOf(app, id)).body.items as Item[];
    expect(before.some((i) => i.kind === 'fix-finding')).toBe(true);
    expect((await reportOf(app, id)).body.findings.tables.leaked).toBe(1);

    expect((await post(app, retestBody(), `/${id}/retest`)).status).toBe(202);
    await waitUntilDone(app, id);
    const after = (await roadmapOf(app, id)).body.items as Item[];
    expect(after.some((i) => i.kind === 'fix-finding')).toBe(false);
    expect(after.some((i) => i.kind === 'retest')).toBe(false);
    expect(after[0].id).toBe('rm_001');
    const report = await reportOf(app, id);
    expect(report.body.findings.tables.leaked).toBe(0);
    expect(report.body.decision).toBe('ready_by_these_checks');
  });

  it('a failed re-test leaves the roadmap and the client report as they were', async () => {
    let call = 0;
    class Broken extends FakeGateway {
      override fetchOpenApi(): Promise<unknown> {
        return Promise.reject(new Error('request failed'));
      }
    }
    app = await buildWith(() => (++call === 1 ? new FakeGateway(demoTables()) : new Broken(demoTables())), ON);
    const res = await post(app, validBody());
    const id = res.body.id as string;
    await waitUntilDone(app, id);
    const roadmap = (await roadmapOf(app, id)).body as unknown;
    const report = (await reportOf(app, id)).body as unknown;
    expect((await post(app, retestBody(), `/${id}/retest`)).status).toBe(202);
    const done = await waitUntilDone(app, id);
    expect(done.body.lastRetest.status).toBe('failed');
    expect((await roadmapOf(app, id)).body).toEqual(roadmap);
    expect((await reportOf(app, id)).body).toEqual(report);
  });

  it('they are still there after a restart (a new app on the same audit store)', async () => {
    const repo = new InMemoryAuditRepository();
    app = await buildWith(demo, ON, undefined, repo);
    const res = await post(app, validBody());
    const id = res.body.id as string;
    await waitUntilDone(app, id);
    const roadmap = (await roadmapOf(app, id)).body as unknown;
    const report = (await reportOf(app, id)).body as unknown;
    // wait until the store holds the finished audit
    for (let i = 0; i < 200 && (await repo.get(id))?.record.status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await app.close();

    app = await buildWith(demo, ON, undefined, repo);
    expect((await getAudit(app, id)).status).toBe(200);
    const again = await roadmapOf(app, id);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(roadmap);
    expect((await reportOf(app, id)).body).toEqual(report);
  });
});

describe('flag off: nothing exists', () => {
  it('both routes answer 404 NOT_FOUND, and GET /audits/:id has no roadmap row', async () => {
    app = await buildWith(demo, AGENTS_OFF);
    const res = await post(app, validBody());
    const done = await waitUntilDone(app, res.body.id);
    for (const path of ['roadmap', 'client-report']) {
      const r = await request(app.getHttpServer()).get(`/api/v1/audits/${res.body.id}/${path}`);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    }
    expect((done.body.modules as { id: string }[]).map((m) => m.id)).toEqual(['data-access-prover']);
  });

  it('an audit that has stage fields but no roadmap (made before this step) is 404 too', async () => {
    const repo = new InMemoryAuditRepository();
    app = await buildWith(demo, ON, undefined, repo);
    const res = await post(app, validBody());
    const id = res.body.id as string;
    await waitUntilDone(app, id);
    for (let i = 0; i < 200 && (await repo.get(id))?.record.status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await app.close();
    // take the two new fields out of the stored record, as if it was made before
    const stored = (await repo.get(id))!;
    delete stored.record.lockC!.roadmap;
    delete stored.record.lockC!.clientReport;
    repo.rows.set(id, stored);
    app = await buildWith(demo, ON, undefined, repo);
    expect((await roadmapOf(app, id)).status).toBe(404);
    expect((await reportOf(app, id)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`/api/v1/audits/${id}/evidence`)).status).toBe(200);
  });
});
