import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import {
  SafeFetchError,
  type SafeFetchResult,
} from '../../src/net/safe-fetch.js';
import { buildWith } from '../agents/scenarios.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  PROJECT_URL,
  PUBLISHABLE,
  SECRET,
  demoTables,
  post,
  waitUntilDone,
} from '../report/helpers.js';
import { allStrings, BANNED_EN, BANNED_UR } from '../stages/roadmap-fixtures.js';
import { buildZip } from '../repo/zip-builder.js';

/**
 * The mock bundles for the frontend (docs/frontend-mock). Every file is what
 * the REAL code answers for a run: a fake Supabase project and a fake website
 * stand in for the network, and everything else (the Prover, the agents, the
 * stages, the routes) is the real code. Random ids and times are replaced by
 * fixed values. No key is in any file (the test checks that).
 *
 * To write the files again (only on purpose):
 *   UPDATE_MOCKS=1 npx vitest run test/frontend/mock-bundles.spec.ts
 * Without UPDATE_MOCKS the test compares the real answers with the files, so a
 * mock can never drift from the code.
 */
const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'frontend-mock',
);
const update = process.env.UPDATE_MOCKS === '1';

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
const FAKE_KEY = 'sb_secret_MockMockMockMock0123456789';
const MOCK_PROJECT = 'https://example-project.supabase.co';
const REPO_URL = 'https://github.com/example-owner/example-shop';
// the repository of the "repo-only" bundle: a key on line 3 of one file
const repoSetup = {
  transport: {
    fetchArchive: () =>
      Promise.resolve(
        buildZip([
          {
            name: 'example-owner-example-shop-1a2b3c/src/lib/supabase.ts',
            data: `import { createClient } from '@supabase/supabase-js';\n\nconst KEY = "${FAKE_KEY}";\n`,
          },
          {
            name: 'example-owner-example-shop-1a2b3c/src/app.ts',
            data: 'export const app = 1;\n',
          },
          // a public variable that says SERVICE_ROLE (rule 2): a warning sign
          {
            name: 'example-owner-example-shop-1a2b3c/.env.example',
            data: 'NEXT_PUBLIC_SUPABASE_URL=https://example-project.supabase.co\nNEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=\n',
          },
          // a table with no "enable row level security" in the migrations (rule 1)
          {
            name: 'example-owner-example-shop-1a2b3c/supabase/migrations/001_init.sql',
            data: '-- the shop tables\ncreate table public.orders (\n  id uuid primary key,\n  user_id uuid\n);\n',
          },
        ]),
      ),
  },
  secrets: [],
};
const T_START = '2026-11-15T10:00:00Z';
const T_END = '2026-11-15T10:00:40Z';

const answer = (url: string, body: string, headers: Record<string, string>) =>
  ({ url, status: 200, headers, body: Buffer.from(body) }) as SafeFetchResult;

// A site with a secret key in one of its scripts, and weak headers.
function serveSite(): void {
  site.handler = async (url) => {
    if (url === `${WEBSITE}/` || url === WEBSITE) {
      return answer(
        `${WEBSITE}/`,
        '<html><script src="/assets/app.js?v=7"></script><script src="/assets/vendor.js"></script></html>',
        { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' },
      );
    }
    const path = new URL(url).pathname;
    if (path === '/assets/app.js') {
      return answer(url, `const k = "${FAKE_KEY}";`, {});
    }
    if (path === '/assets/vendor.js') return answer(url, 'run();', {});
    throw new SafeFetchError('NETWORK');
  };
}

interface Bundle {
  name: string;
  /** what the form sends, with placeholders instead of keys */
  request: Record<string, unknown>;
  /** what the test really sends */
  send: Record<string, unknown>;
}

const supabaseFields = {
  projectUrl: PROJECT_URL,
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
};
const supabasePlaceholders = {
  projectUrl: MOCK_PROJECT,
  anonKey: '<publishable key: write-only, never returned>',
  serviceKey: '<secret key: write-only, never returned>',
  confirmTestProject: true,
};

const BUNDLES: Bundle[] = [
  {
    name: 'supabase-only',
    request: { label: 'Hotel booking (test project)', ...supabasePlaceholders },
    send: { label: 'Hotel booking (test project)', ...supabaseFields },
  },
  {
    name: 'url-only',
    request: {
      label: 'Example shop',
      websiteUrl: WEBSITE,
      confirmSiteAccess: true,
    },
    send: {
      label: 'Example shop',
      websiteUrl: WEBSITE,
      confirmSiteAccess: true,
    },
  },
  {
    // A1: a public repository only. Its gate is not ready because of the key.
    name: 'repo-only',
    request: {
      label: 'Example shop (code)',
      repoUrl: REPO_URL,
      confirmRepoAccess: true,
    },
    send: {
      label: 'Example shop (code)',
      repoUrl: REPO_URL,
      confirmRepoAccess: true,
    },
  },
  {
    name: 'both',
    request: {
      label: 'Example shop and its database',
      websiteUrl: WEBSITE,
      confirmSiteAccess: true,
      ...supabasePlaceholders,
    },
    send: {
      label: 'Example shop and its database',
      websiteUrl: WEBSITE,
      confirmSiteAccess: true,
      ...supabaseFields,
    },
  },
];

const FILES = [
  ['audit.json', ''],
  ['findings.json', '/findings'],
  ['evidence.json', '/evidence'],
  ['roadmap.json', '/roadmap'],
  ['client-report.json', '/client-report'],
] as const;

/** Random values replaced by fixed ones, and the made-up project address by an example one. */
function stable(value: unknown): unknown {
  const text = JSON.stringify(value, (key, item: unknown) =>
    // `progress` of a finished run is always 100: nothing to drop here
    key === 'version' ? undefined : item,
  )
    .replace(/aud_[0-9a-f]{16}/g, 'aud_001')
    .replaceAll(PROJECT_URL, MOCK_PROJECT)
    .replace(/vca-[0-9a-f]{12}@example\.com/g, 'vca-example@example.com');
  const parsed = JSON.parse(text) as unknown;
  const times = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(times);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [
          k,
          typeof v === 'string' &&
          /^(createdAt|startedAt)$/.test(k) &&
          /^\d{4}-/.test(v)
            ? T_START
            : typeof v === 'string' &&
                /^(finishedAt|lastRunAt|completedAt|issuedAt)$/.test(k) &&
                /^\d{4}-/.test(v)
              ? T_END
              : times(v),
        ]),
      );
    }
    return node;
  };
  // canary row ids are random: number them in the order they appear
  const seen = new Map<string, string>();
  const text2 = JSON.stringify(times(parsed)).replace(
    /"canaryRowId":"([^"]+)"/g,
    (_all, id: string) => {
      if (!seen.has(id)) {
        seen.set(id, `canary-${String(seen.size + 1).padStart(4, '0')}`);
      }
      return `"canaryRowId":"${seen.get(id)}"`;
    },
  );
  const withCanary = text2.replace(
    /\b(?:canary-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
    (id) => {
      if (!seen.has(id)) {
        seen.set(id, `canary-${String(seen.size + 1).padStart(4, '0')}`);
      }
      return seen.get(id)!;
    },
  );
  return JSON.parse(withCanary) as unknown;
}

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

let app: INestApplication | undefined;
beforeEach(() => {
  serveSite();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function runBundle(bundle: Bundle): Promise<Record<string, unknown>> {
  app = await buildWith(
    () => new FakeGateway(demoTables()),
    { ...AGENTS_OFF, enabled: true },
    undefined,
    undefined,
    repoSetup,
  );
  const started = await post(app, bundle.send);
  expect(started.status).toBe(202);
  const id = started.body.id as string;
  const done = await waitUntilDone(app, id);
  expect(done.body.status).toBe('completed');
  const out: Record<string, unknown> = {
    'request.json': bundle.request,
    'audit.json': done.body,
  };
  for (const [file, path] of FILES) {
    if (file === 'audit.json') continue;
    const res = await request(app.getHttpServer()).get(
      `/api/v1/audits/${id}${path}`,
    );
    expect(res.status).toBe(200);
    out[file] = res.body;
  }
  return out;
}

describe('docs/frontend-mock: the three bundles are what the real code answers', () => {
  for (const bundle of BUNDLES) {
    it(`bundle "${bundle.name}"`, async () => {
      const files = await runBundle(bundle);
      const json = JSON.stringify(stable(files));
      // no key, no query, no made-up address of the tested project
      for (const secret of [FAKE_KEY, SECRET, PUBLISHABLE, PROJECT_URL, 'v=7']) {
        expect(json).not.toContain(secret);
      }
      // the roadmap and the client report follow the wording rule
      for (const text of [
        ...allStrings(files['roadmap.json']),
        ...allStrings(files['client-report.json']),
      ]) {
        expect(text).not.toMatch(BANNED_EN);
        expect(text).not.toMatch(BANNED_UR);
      }
      for (const [file, body] of Object.entries(files)) {
        const path = join(dir, bundle.name, file);
        const got = stable(body);
        if (update) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, pretty(got));
          continue;
        }
        expect(existsSync(path), `${bundle.name}/${file} is missing`).toBe(true);
        expect(got, `${bundle.name}/${file} differs from the code`).toEqual(
          JSON.parse(readFileSync(path, 'utf8')) as unknown,
        );
      }
    }, 30_000);
  }
});
