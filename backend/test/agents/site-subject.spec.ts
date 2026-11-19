import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { createBundleInspectorAgent } from '../../src/agents/bundle-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import {
  SafeFetchError,
  type SafeFetchResult,
} from '../../src/net/safe-fetch.js';
import { scriptName } from '../../src/stages/site-rules.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import { demoTables, post, waitUntilDone } from '../report/helpers.js';
import { buildWith } from './scenarios.js';

const site = vi.hoisted(() => ({
  handler: undefined as undefined | ((url: string) => Promise<unknown>),
}));
vi.mock('../../src/net/safe-fetch.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/net/safe-fetch.js')>();
  return {
    ...original,
    safeFetch: (url: string) => {
      if (!site.handler) throw new Error('no fake site');
      return site.handler(url);
    },
  };
});

const WEBSITE = 'https://www.example-shop.com';
const KEY = 'sb_secret_AbCdEfGhIjKlMnOp123456';
const TOKEN = 'TOKEN-IN-THE-QUERY-9981';
const FRAGMENT = 'FRAGMENT-7731';

describe('scriptName: host + path, and nothing else', () => {
  const cases: [string, string][] = [
    [
      `https://www.example-shop.com/app.js?token=${TOKEN}`,
      'www.example-shop.com/app.js',
    ],
    [
      `https://www.example-shop.com/app.js#${FRAGMENT}`,
      'www.example-shop.com/app.js',
    ],
    [
      `https://www.example-shop.com/app.js?a=1&b=2#${FRAGMENT}`,
      'www.example-shop.com/app.js',
    ],
    ['https://www.example-shop.com/', 'www.example-shop.com/'],
    ['https://www.example-shop.com', 'www.example-shop.com/'],
    [
      'https://user:pa55word@www.example-shop.com/x.js',
      'www.example-shop.com/x.js',
    ],
    [
      'https://www.example-shop.com:8443/x.js?k=1',
      'www.example-shop.com:8443/x.js',
    ],
    [
      'https://www.example-shop.com/a%20b/x.js?k=1',
      'www.example-shop.com/a%20b/x.js',
    ],
    [
      'https://WWW.Example-Shop.COM/Assets/App.js',
      'www.example-shop.com/Assets/App.js',
    ],
    ['https://www.example-shop.com/x.js?', 'www.example-shop.com/x.js'],
  ];
  for (const [input, expected] of cases) {
    it(`${input.replace(TOKEN, '<token>').replace(FRAGMENT, '<fragment>')}  ->  ${expected}`, () => {
      expect(scriptName(input)).toBe(expected);
    });
  }

  it('what comes out never holds a query, a hash or a login', () => {
    for (const [input] of cases) {
      const name = scriptName(input);
      expect(name).not.toMatch(/[?#@]/);
      expect(name).not.toContain('pa55word');
      expect(name).not.toContain(TOKEN);
    }
  });
});

describe('the Bundle inspector writes only host + path in every name it gives', () => {
  const control: AgentControl = {
    shouldStop: () => false,
    redact: (t) => t,
    states: () => [],
    failure: () => null,
  };
  const reply = (url: string, body: string, status = 200): SafeFetchResult => ({
    url,
    status,
    headers: {},
    body: Buffer.from(body),
  });

  it('the evidence subject, the not-read names and the out-of-scope names', async () => {
    const page = `<script src="/leaky.js?token=${TOKEN}#${FRAGMENT}"></script>
      <script src="/gone.js?token=${TOKEN}#${FRAGMENT}"></script>
      <script src="https://cdn.other.net/lib.js?token=${TOKEN}#${FRAGMENT}"></script>`;
    const fetcher = async (url: string): Promise<SafeFetchResult> => {
      if (url === WEBSITE) return reply(`${WEBSITE}/`, page);
      if (url.includes('/leaky.js')) return reply(url, `var k="${KEY}"`);
      return reply(url, 'not found', 404);
    };
    const context: RunContext = {
      websiteUrl: WEBSITE,
      siteResults: {},
      siteEvidence: [],
    };
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control,
    );

    expect(context.siteEvidence!.map((e) => e.subject)).toEqual([
      'www.example-shop.com/leaky.js',
    ]);
    const result = context.siteResults!['bundle-secrets'];
    expect(result.notRead!.map((n) => n.name)).toEqual([
      'www.example-shop.com/gone.js',
    ]);
    expect(result.outOfScope!.map((o) => o.name)).toEqual([
      'cdn.other.net/lib.js',
    ]);

    const everything = JSON.stringify(context);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(FRAGMENT);
    expect(everything).not.toContain(KEY);
  });

  it('a script address with a login in it is not fetched (the safe fetcher refuses it) and its name has no login', async () => {
    const page = `<script src="https://user:pa55word@www.example-shop.com/x.js?k=1"></script>`;
    const fetcher = async (url: string): Promise<SafeFetchResult> => {
      if (url === WEBSITE) return reply(`${WEBSITE}/`, page);
      throw new SafeFetchError('BAD_URL');
    };
    const context: RunContext = {
      websiteUrl: WEBSITE,
      siteResults: {},
      siteEvidence: [],
    };
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control,
    );
    const result = context.siteResults!['bundle-secrets'];
    expect(result.notRead!.map((n) => n.name)).toEqual([
      'www.example-shop.com/x.js',
    ]);
    expect(JSON.stringify(context)).not.toContain('pa55word');
  });
});

describe('the answers of the API never hold a query or a hash of a script address', () => {
  let app: INestApplication | undefined;
  beforeEach(() => {
    site.handler = undefined;
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET audit, /findings and /evidence', async () => {
    const GOOD = { 'x-content-type-options': 'nosniff' };
    site.handler = (url) => {
      if (url === WEBSITE) {
        return Promise.resolve({
          url: `${WEBSITE}/`,
          status: 200,
          headers: GOOD,
          body: Buffer.from(
            `<script src="/leaky.js?token=${TOKEN}#${FRAGMENT}"></script>
             <script src="https://cdn.other.net/lib.js?token=${TOKEN}"></script>`,
          ),
        });
      }
      return Promise.resolve({
        url,
        status: 200,
        headers: GOOD,
        body: Buffer.from(`var k="${KEY}"`),
      });
    };
    app = await buildWith(() => new FakeGateway(demoTables()), {
      ...AGENTS_OFF,
      enabled: true,
    });
    const res = await post(app, {
      websiteUrl: WEBSITE,
      confirmSiteAccess: true,
    });
    const done = await waitUntilDone(app, res.body.id);
    const http = request(app.getHttpServer());
    const evidence = (await http.get(`/api/v1/audits/${res.body.id}/evidence`))
      .body as {
      items: { subject?: string; kind?: string }[];
    };
    const findings = (await http.get(`/api/v1/audits/${res.body.id}/findings`))
      .body;

    expect(
      evidence.items
        .filter((i) => i.kind === 'site-bundle')
        .map((i) => i.subject),
    ).toEqual(['www.example-shop.com/leaky.js']);
    const everything = JSON.stringify([done.body, evidence, findings]);
    for (const secret of [TOKEN, FRAGMENT, KEY, 'token=']) {
      expect(everything).not.toContain(secret);
    }
  });
});
