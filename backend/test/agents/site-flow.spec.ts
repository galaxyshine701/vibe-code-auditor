import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import type { SafeFetchResult } from '../../src/net/safe-fetch.js';
import { SafeFetchError } from '../../src/net/safe-fetch.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  SECRET,
  demoTables,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';
import { buildWith } from './scenarios.js';

// The network is the only fake here: safeFetch answers from the test. The
// agents, the pipeline, the stages and the service are the real ones.
const site = vi.hoisted(() => ({
  handler: undefined as
    | undefined
    | ((url: string, options?: { maxBytes?: number }) => Promise<unknown>),
  calls: [] as string[],
}));
vi.mock('../../src/net/safe-fetch.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/net/safe-fetch.js')>();
  return {
    ...original,
    safeFetch: (url: string, options?: { maxBytes?: number }) => {
      site.calls.push(url);
      if (!site.handler) throw new Error('no fake site');
      return site.handler(url, options);
    },
  };
});

const WEBSITE = 'https://www.example-shop.com';
const ON = { ...AGENTS_OFF, enabled: true };
const KEY = 'sb_secret_AbCdEfGhIjKlMnOp123456';
const GOOD = {
  'strict-transport-security': 'max-age=63072000',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};
const urlBody = (extra: Record<string, unknown> = {}) => ({
  websiteUrl: WEBSITE,
  confirmSiteAccess: true,
  ...extra,
});

const answer = (
  url: string,
  body: string,
  headers: Record<string, string> = GOOD,
): SafeFetchResult => ({ url, status: 200, headers, body: Buffer.from(body) });

/** A site with the given scripts (path -> source). */
function serve(scripts: Record<string, string>, headers = GOOD) {
  site.handler = async (url) => {
    if (url === `${WEBSITE}/` || url === WEBSITE) {
      return answer(
        `${WEBSITE}/`,
        `<html><head>${Object.keys(scripts)
          .map((p) => `<script src="${p}"></script>`)
          .join('')}</head></html>`,
        headers,
      );
    }
    const path = new URL(url).pathname;
    if (path in scripts) return answer(url, scripts[path]);
    throw new SafeFetchError('NETWORK');
  };
}

type Row = { id: string; status: string; progress: number; message?: string };
type Reason = { en: string; ur: string };
type Evidence = {
  items: {
    check: string;
    kind?: string;
    findingId: string | null;
    table: string | null;
    subject?: string;
    verdict: string;
  }[];
  coverage: {
    checked: string[];
    partial: unknown[];
    failedToRun: { id: string; reason: Reason }[];
    outOfScope: { name: string; reason: Reason }[];
  };
};

const evidenceOf = async (app: INestApplication, id: string) =>
  (await request(app.getHttpServer()).get(`/api/v1/audits/${id}/evidence`))
    .body as Evidence;

let app: INestApplication | undefined;
beforeEach(() => {
  site.handler = undefined;
  site.calls.length = 0;
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const noGateway = () => new FakeGateway(demoTables());

describe('flag on: a website-only audit with both inspectors', () => {
  it('a clean site: both checks completed, the gate is ready_by_these_checks with no reasons', async () => {
    serve({ '/a.js': 'console.log(1)', '/b.js': 'run()' });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);

    expect(done.body.status).toBe('completed');
    expect(done.body.gate).toEqual({
      decision: 'ready_by_these_checks',
      reasons: [],
    });
    const rows = done.body.modules as Row[];
    expect(rows.map((m) => m.id)).toEqual([
      'data-access-prover',
      'planner',
      'ownership',
      'tls-headers',
      'bundle-secrets',
      'evidence',
      'roadmap',
      'guide',
    ]);
    expect(rows.find((m) => m.id === 'tls-headers')!.status).toBe('completed');
    expect(rows.find((m) => m.id === 'bundle-secrets')!.status).toBe(
      'completed',
    );

    const evidence = await evidenceOf(app, res.body.id);
    expect(evidence.coverage.checked).toEqual([
      'tls-headers',
      'bundle-secrets',
    ]);
    expect(evidence.coverage.partial).toEqual([]);
    // the certificate itself is named, as left out on purpose
    expect(evidence.coverage.outOfScope.map((o) => o.name)).toContain(
      'TLS validity period and expiry',
    );
    // evidence about the site: no finding, no table, a kind and a subject
    expect(evidence.items.length).toBeGreaterThan(0);
    for (const item of evidence.items) {
      expect(item).toMatchObject({
        findingId: null,
        table: null,
        kind: 'site-headers',
      });
      expect(item.subject).toBeTruthy();
    }
  });

  it('the summary and the findings stay about tables only (zero here)', async () => {
    serve({ '/a.js': 'ok()' });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.summary).toEqual({
      leaked: 0,
      blocked: 0,
      inconclusive: 0,
      siteLeaked: 0, // additive: an audit with a website says how many script leaks
    });
  });

  it('a secret key in a script: the gate is not_ready, there is a LEAKED site-bundle item, and the key is nowhere', async () => {
    serve({ '/a.js': 'ok()', '/app.js': `var k = "${KEY}";` });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);

    expect(done.body.status).toBe('completed');
    expect(done.body.gate.decision).toBe('not_ready');
    expect(
      (done.body.gate.reasons as Reason[]).some((r) => /leak/i.test(r.en)),
    ).toBe(true);
    const evidence = await evidenceOf(app, res.body.id);
    const leak = evidence.items.find((i) => i.kind === 'site-bundle')!;
    expect(leak).toMatchObject({
      check: 'bundle-secrets',
      verdict: 'LEAKED',
      findingId: null,
      table: null,
      subject: 'www.example-shop.com/app.js',
    });
    const everything = JSON.stringify([
      done.body,
      evidence,
      await request(app.getHttpServer()).get(
        `/api/v1/audits/${res.body.id}/findings`,
      ),
    ]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('AbCdEfGhIjKl');
  });

  it('a site that cannot be reached: both checks failedToRun with a fixed sentence, not_ready, the audit still completes', async () => {
    site.handler = async () => {
      throw new SafeFetchError('BLOCKED_ADDRESS');
    };
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.status).toBe('completed');
    expect(done.body.gate.decision).toBe('not_ready');
    const evidence = await evidenceOf(app, res.body.id);
    expect(evidence.coverage.checked).toEqual([]);
    expect(evidence.coverage.failedToRun.map((f) => f.id).sort()).toEqual([
      'bundle-secrets',
      'tls-headers',
    ]);
    for (const failed of evidence.coverage.failedToRun) {
      expect(failed.reason.en).toBe(
        new SafeFetchError('BLOCKED_ADDRESS').message,
      );
    }
    expect(JSON.stringify(done.body)).not.toContain('example-shop.com/');
  });

  it('too many scripts: the check is partial, and a partial required check keeps it not_ready', async () => {
    const scripts: Record<string, string> = {};
    for (let i = 0; i < 40; i++) scripts[`/s${i}.js`] = 'ok()';
    serve(scripts);
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    const evidence = await evidenceOf(app, res.body.id);
    expect(evidence.coverage.partial).toHaveLength(1);
    expect(done.body.gate.decision).toBe('not_ready');
    // 1 page for the headers + 1 page and 30 scripts for the bundle scan
    expect(site.calls.length).toBe(1 + 1 + 30);
  });

  it('inspectors that never return: the audit still ends at their deadline, with failed rows (TIMEOUT) and a not_ready gate', async () => {
    site.handler = () => new Promise(() => undefined);
    app = await buildWith(noGateway, { ...ON, inspectorDeadlineMs: 50 });
    const started = Date.now();
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(done.body.status).toBe('completed');
    const rows = done.body.modules as Row[];
    for (const id of ['tls-headers', 'bundle-secrets']) {
      const row = rows.find((m) => m.id === id)!;
      expect(row.status).toBe('failed');
      expect(row.message).toMatch(/too long/);
    }
    expect(rows.find((m) => m.id === 'guide')!.status).toBe('completed');
    expect(done.body.gate.decision).toBe('not_ready');
    // the next audit can start: runningId is free
    const next = await post(app, urlBody());
    expect(next.status).toBe(202);
    await waitUntilDone(app, next.body.id);
  });
});

describe('flag on: a website together with Supabase details', () => {
  it('the Prover and the inspectors both run; the evidence has table items and site items', async () => {
    serve({ '/a.js': 'ok()' });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody({ ...validBody() }));
    expect(res.status).toBe(202);
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.status).toBe('completed');
    const rows = done.body.modules as Row[];
    expect(rows.map((m) => m.id)).toEqual([
      'data-access-prover',
      'planner',
      'ownership',
      'tls-headers',
      'bundle-secrets',
      'evidence',
      'roadmap',
      'guide',
    ]);
    const evidence = await evidenceOf(app, res.body.id);
    expect(evidence.items.some((i) => i.table !== null)).toBe(true);
    expect(evidence.items.some((i) => i.kind === 'site-headers')).toBe(true);
    // the table items are as they always were: no kind, a finding id
    const tableItem = evidence.items.find((i) => i.table !== null)!;
    expect(tableItem.kind).toBeUndefined();
    expect(tableItem.findingId).toMatch(/^fnd_/);
    expect(evidence.coverage.checked).toEqual(
      expect.arrayContaining([
        'data-access-prover',
        'tls-headers',
        'bundle-secrets',
      ]),
    );
    expect(done.body.summary.leaked).toBe(1);
  });

  it('the Prover fails: the audit is failed, but what the inspectors found is still in the evidence', async () => {
    serve({ '/app.js': `var k = "${KEY}";` });
    class BrokenGateway extends FakeGateway {
      override fetchOpenApi(): Promise<unknown> {
        return Promise.reject(new Error(`request failed for key ${SECRET}`));
      }
    }
    app = await buildWith(() => new BrokenGateway(demoTables()), ON);
    const res = await post(app, urlBody({ ...validBody() }));
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.status).toBe('failed');
    expect(done.body.gate.decision).toBe('not_ready');
    const evidence = await evidenceOf(app, res.body.id);
    expect(evidence.coverage.checked).toEqual(
      expect.arrayContaining(['tls-headers', 'bundle-secrets']),
    );
    expect(evidence.coverage.failedToRun.map((f) => f.id)).toContain(
      'data-access-prover',
    );
    expect(evidence.items.some((i) => i.kind === 'site-bundle')).toBe(true);
    expect(JSON.stringify([done.body, evidence])).not.toContain(KEY);
    expect(JSON.stringify([done.body, evidence])).not.toContain(SECRET);
  });
});

describe('the inspectors only run when a website was given, and only with the flag on', () => {
  it('flag on, a Supabase-only request: no site fetch at all', async () => {
    serve({});
    app = await buildWith(noGateway, ON);
    const res = await post(app, validBody());
    await waitUntilDone(app, res.body.id);
    expect(site.calls).toEqual([]);
  });

  it('flag off, a request with a websiteUrl: ignored, no site fetch at all, no site rows', async () => {
    serve({});
    app = await buildWith(noGateway, AGENTS_OFF);
    const res = await post(app, {
      ...validBody(),
      websiteUrl: WEBSITE,
      confirmSiteAccess: true,
    });
    const done = await waitUntilDone(app, res.body.id);
    expect(site.calls).toEqual([]);
    expect((done.body.modules as Row[]).map((m) => m.id)).toEqual([
      'data-access-prover',
    ]);
  });
});
