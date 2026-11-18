import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { SafeFetchError } from '../../src/net/safe-fetch.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  demoTables,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';
import { buildWith } from './scenarios.js';

// Only the network is fake. Everything else is the real code.
const site = vi.hoisted(() => ({
  handler: undefined as undefined | ((url: string) => Promise<unknown>),
  calls: 0,
}));
vi.mock('../../src/net/safe-fetch.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/net/safe-fetch.js')>();
  return {
    ...original,
    safeFetch: (url: string) => {
      site.calls += 1;
      if (!site.handler) throw new Error('no fake site');
      return site.handler(url);
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

/** A site whose scripts are given as path -> source. */
function serve(scripts: Record<string, string>) {
  site.handler = (url) => {
    if (url === WEBSITE) {
      const html = Object.keys(scripts)
        .map((p) => `<script src="${p}"></script>`)
        .join('');
      return Promise.resolve({
        url: `${WEBSITE}/`,
        status: 200,
        headers: GOOD,
        body: Buffer.from(html),
      });
    }
    const path = new URL(url).pathname;
    return path in scripts
      ? Promise.resolve({
          url,
          status: 200,
          headers: GOOD,
          body: Buffer.from(scripts[path]),
        })
      : Promise.reject(new SafeFetchError('NETWORK'));
  };
}

type Summary = Record<string, number>;

let app: INestApplication | undefined;
beforeEach(() => {
  site.handler = undefined;
  site.calls = 0;
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
const noGateway = () => new FakeGateway(demoTables());

describe('summary.siteLeaked: the leaks found in the scripts of a website', () => {
  it('a website with a secret key in two scripts and one clean: siteLeaked is the number of leaks, summary.leaked is untouched', async () => {
    serve({
      '/a.js': `var k="${KEY}"`,
      '/b.js': `var k="${KEY}"`,
      '/c.js': 'ok()',
    });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.summary).toEqual({
      leaked: 0, // tables only, as ever
      blocked: 0,
      inconclusive: 0,
      siteLeaked: 2,
    });
  });

  it('a clean website: siteLeaked is 0 (the key is there, so the client knows the site was looked at)', async () => {
    serve({ '/a.js': 'ok()' });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(done.body.summary).toEqual({
      leaked: 0,
      blocked: 0,
      inconclusive: 0,
      siteLeaked: 0,
    });
  });

  it('a website that could not be read: siteLeaked is 0 (nothing was found, and the coverage says nothing was checked)', async () => {
    site.handler = () => Promise.reject(new SafeFetchError('NETWORK'));
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    expect((done.body.summary as Summary).siteLeaked).toBe(0);
    expect(done.body.gate.decision).toBe('not_ready');
  });

  it('a header that is missing is not a leak: siteLeaked does not count it', async () => {
    site.handler = (url) =>
      Promise.resolve({
        url: url === WEBSITE ? `${WEBSITE}/` : url,
        status: 200,
        headers: {},
        body: Buffer.from('<html></html>'),
      });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    const done = await waitUntilDone(app, res.body.id);
    expect((done.body.summary as Summary).siteLeaked).toBe(0);
  });

  it('a website together with Supabase: both counts, each about its own thing', async () => {
    serve({ '/a.js': `var k="${KEY}"` });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody({ ...validBody() }));
    const done = await waitUntilDone(app, res.body.id);
    const summary = done.body.summary as Summary;
    expect(summary.leaked).toBe(1); // the table that is not protected
    expect(summary.siteLeaked).toBe(1); // the key in the script
    expect(summary.blocked + summary.inconclusive).toBe(2);
  });

  it('a request with no website has no siteLeaked at all: the summary is the old one (flag on)', async () => {
    serve({});
    app = await buildWith(noGateway, ON);
    const res = await post(app, validBody());
    const done = await waitUntilDone(app, res.body.id);
    expect(Object.keys(done.body.summary as Summary)).toEqual([
      'leaked',
      'blocked',
      'inconclusive',
    ]);
    expect(site.calls).toBe(0);
  });

  it('flag off: a websiteUrl is ignored and the summary is the old one', async () => {
    serve({ '/a.js': `var k="${KEY}"` });
    app = await buildWith(noGateway, AGENTS_OFF);
    const res = await post(app, {
      ...validBody(),
      websiteUrl: WEBSITE,
      confirmSiteAccess: true,
    });
    const done = await waitUntilDone(app, res.body.id);
    expect(Object.keys(done.body.summary as Summary)).toEqual([
      'leaked',
      'blocked',
      'inconclusive',
    ]);
    expect(site.calls).toBe(0);
  });

  it('the count is kept with the audit: reading it again gives the same answer', async () => {
    serve({ '/a.js': `var k="${KEY}"` });
    app = await buildWith(noGateway, ON);
    const res = await post(app, urlBody());
    await waitUntilDone(app, res.body.id);
    const again = await request(app.getHttpServer()).get(
      `/api/v1/audits/${res.body.id}`,
    );
    expect((again.body.summary as Summary).siteLeaked).toBe(1);
  });
});
