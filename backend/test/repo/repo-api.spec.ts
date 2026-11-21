import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import { AGENTS_OFF, AGENTS_SETUP } from '../../src/agents/agents-config.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { ApiError } from '../../src/common/api-error.js';
import { parseAuditRequest } from '../../src/audits/audit-input.js';
import { AUDIT_REPOSITORY } from '../../src/audits/audit-repository.js';
import { GATEWAY_FACTORY } from '../../src/audits/audits.service.js';
import { REPO_SETUP } from '../../src/repo/repo-config.js';
import { RepoFetchError, type RepoTransport } from '../../src/repo/repo-scanner.js';
import { REPORT_SETUP } from '../../src/report/report-config.js';
import { InMemoryAuditRepository } from '../audits/in-memory-audit-repository.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';
import { post, validBody, waitUntilDone } from '../report/helpers.js';
import { buildZip, type TestEntry } from './zip-builder.js';

const ON = { ...AGENTS_OFF, enabled: true };
const SECRET = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0';
const TOKEN = 'github_pat_' + 'NEVERLOGTHISTOKEN12345';
const REPO_URL = 'https://github.com/someone/app';

describe('parseAuditRequest: repoUrl', () => {
  const parse = (body: unknown, on = true) => parseAuditRequest(body, on);
  const fails = (body: unknown) => {
    try {
      parse(body);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      return (error as ApiError).message;
    }
    return 'no error';
  };

  it('takes a plain repository address, with or without .git or a trailing slash', () => {
    for (const url of [
      REPO_URL,
      `${REPO_URL}/`,
      `${REPO_URL}.git`,
      'https://github.com/Some-One/my.app_2',
    ]) {
      const request = parse({ repoUrl: url, confirmRepoAccess: true });
      expect(request.repo?.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
      expect(request.websiteUrl).toBeNull();
      expect(request.supabase).toBeNull();
    }
    expect(parse({ repoUrl: `${REPO_URL}.git`, confirmRepoAccess: true }).repo).toEqual({
      owner: 'someone',
      repo: 'app',
      url: REPO_URL,
    });
    expect(parse({ repoUrl: REPO_URL, confirmRepoAccess: true }).label).toBe('someone/app');
  });

  it('refuses anything that is not a plain public github.com repository', () => {
    for (const bad of [
      'http://github.com/someone/app',
      'https://gitlab.com/someone/app',
      'https://github.com.evil.com/someone/app',
      'https://www.github.com/someone/app',
      'https://github.com/someone',
      'https://github.com/someone/app/tree/main',
      'https://github.com/someone/app?x=1',
      'https://github.com/someone/app#readme',
      'https://token@github.com/someone/app',
      'https://github.com:444/someone/app',
      'https://github.com/../app',
      'https://github.com/someone/..',
      'not a url',
      '',
      42,
      null,
    ]) {
      expect(fails({ repoUrl: bad, confirmRepoAccess: true })).toMatch(/^repoUrl must look like/);
    }
  });

  it('a repoUrl needs confirmRepoAccess: true (the caller says it is public and theirs to scan)', () => {
    expect(fails({ repoUrl: REPO_URL })).toMatch(/confirmRepoAccess/);
    expect(fails({ repoUrl: REPO_URL, confirmRepoAccess: 'yes' })).toMatch(/confirmRepoAccess/);
    expect(fails({ repoUrl: REPO_URL, confirmRepoAccess: false })).toMatch(/confirmRepoAccess/);
  });

  it('the message never contains the value it refused', () => {
    expect(fails({ repoUrl: 'https://evil.example/ZZZ-secret-ZZZ' })).not.toContain('ZZZ');
  });

  it('flag off: repoUrl is ignored like any extra field (the old parser, the old message)', () => {
    expect(() => parse({ repoUrl: REPO_URL }, false)).toThrow(/confirmTestProject/);
  });

  it('a body without repoUrl is parsed exactly as before', () => {
    const request = parse({
      websiteUrl: 'https://www.example.com',
      confirmSiteAccess: true,
    });
    expect('repo' in request).toBe(false);
    expect(request.websiteUrl).toBe('https://www.example.com');
  });

  it('a website with a repo needs the site confirmation, a repo alone does not', () => {
    expect(() =>
      parse({ websiteUrl: 'https://www.example.com', repoUrl: REPO_URL }),
    ).toThrow(/confirmSiteAccess/);
    expect(
      parse({
        websiteUrl: 'https://www.example.com',
        confirmSiteAccess: true,
        repoUrl: REPO_URL,
        confirmRepoAccess: true,
      }).label,
    ).toBe('www.example.com');
  });
});

// ---- the whole flow, with a fake GitHub (the only fake) -------------------

const own: FakeTable[] = [
  { name: 'bookings', policy: 'own', ownerColumn: 'user_id' },
];
const zipOf = (...entries: TestEntry[]): RepoTransport => {
  const calls = { count: 0 };
  return {
    fetchArchive: () => {
      calls.count += 1;
      return Promise.resolve(buildZip(entries));
    },
    ...{ calls },
  } as RepoTransport & { calls: { count: number } };
};
const failing = (error: unknown): RepoTransport => ({
  fetchArchive: () => Promise.reject(error),
});

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(transport: RepoTransport, flag = ON, secrets: string[] = []) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(() => new FakeGateway(own))
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(new InMemoryAuditRepository())
    .overrideProvider(REPORT_SETUP)
    .useValue({ mode: 'off' })
    .overrideProvider(AGENTS_SETUP)
    .useValue(flag)
    .overrideProvider(REPO_SETUP)
    .useValue({ transport, secrets })
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'open' })
    .compile();
  const nest = moduleRef.createNestApplication();
  nest.useLogger(new ConsoleLogger({ logLevels: [] }));
  configureApp(nest, {});
  await nest.init();
  app = nest;
  return nest;
}

const api = (nest: INestApplication, path: string) =>
  request(nest.getHttpServer()).get(`/api/v1/audits/${path}`);

describe('flag on: an audit with Supabase details and a repository', () => {
  it('a clean repo: the repo check is completed and the gate can be ready', async () => {
    const nest = await build(
      zipOf({ name: 'o-r-1/src/a.ts', data: 'export const a = 1;' }),
    );
    const res = await post(nest, { ...validBody(), repoUrl: REPO_URL, confirmRepoAccess: true });
    expect(res.status).toBe(202);
    const done = await waitUntilDone(nest, res.body.id);
    expect(done.body.target.repoUrl).toBe(REPO_URL);
    expect(done.body.summary.repoLeaked).toBe(0);
    expect(done.body.gate).toEqual({ decision: 'ready_by_these_checks', reasons: [] });
    const repoRow = (done.body.modules as { id: string; status: string }[]).find(
      (m) => m.id === 'repo-secrets',
    );
    expect(repoRow?.status).toBe('completed');
    const evidence = (await api(nest, `${res.body.id}/evidence`)).body;
    expect(evidence.coverage.checked).toContain('repo-secrets');
  });

  it('a key in a file: LEAKED evidence with the path only, not ready, never the key', async () => {
    const nest = await build(
      zipOf({ name: 'o-r-1/src/client.ts', data: `const k = "${SECRET}"` }),
    );
    const res = await post(nest, { ...validBody(), repoUrl: REPO_URL, confirmRepoAccess: true });
    const done = await waitUntilDone(nest, res.body.id);
    expect(done.body.summary.repoLeaked).toBe(1);
    expect(done.body.gate.decision).toBe('not_ready');
    const evidence = (await api(nest, `${res.body.id}/evidence`)).body;
    expect(evidence.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'repo-secrets',
          kind: 'repo-file',
          verdict: 'LEAKED',
          subject: 'src/client.ts',
        }),
      ]),
    );
    const report = (await api(nest, `${res.body.id}/client-report`)).body;
    expect(report.findings.repo).toEqual({ leaked: 1 });
    expect(report.headline.en).toMatch(/Leak found by these checks/);
    const everything = JSON.stringify([done.body, evidence, report]);
    expect(everything).not.toContain(SECRET);
  });

  it.each([
    ['403 / 429 (rate limit)', new RepoFetchError('RATE_LIMITED', 'x'), /GitHub refused the request/],
    ['a timeout or redirect refusal', new RepoFetchError('FAILED', 'x'), /could not be fetched/],
    ['not found', new RepoFetchError('NOT_FOUND', 'x'), /not found, or it is private/],
  ])('%s: the check failed to run, and the gate banner says "Repo scan did not run."', async (_n, error, text) => {
    const nest = await build(failing(error));
    const res = await post(nest, { ...validBody(), repoUrl: REPO_URL, confirmRepoAccess: true });
    const done = await waitUntilDone(nest, res.body.id);
    // the run itself completes: the repo check is optional
    expect(done.body.status).toBe('completed');
    expect(done.body.gate.decision).toBe('not_ready');
    expect((done.body.gate.reasons as { en: string }[]).map((r) => r.en)).toContain(
      'Repo scan did not run.',
    );
    const evidence = (await api(nest, `${res.body.id}/evidence`)).body;
    expect(evidence.coverage.failedToRun).toEqual([
      expect.objectContaining({
        id: 'repo-secrets',
        reason: expect.objectContaining({ en: expect.stringMatching(text) }),
      }),
    ]);
  });

  it('the tested project is still checked when the repo fails (the Prover result stands)', async () => {
    const nest = await build(failing(new RepoFetchError('FAILED', 'x')));
    const res = await post(nest, { ...validBody(), repoUrl: REPO_URL, confirmRepoAccess: true });
    const done = await waitUntilDone(nest, res.body.id);
    expect(done.body.summary.blocked).toBe(1);
  });

  it('the token is masked: a transport that throws text with it leaves nothing in any answer', async () => {
    const nest = await build(
      failing(new Error(`ECONNRESET with ${TOKEN}`)),
      ON,
      [TOKEN],
    );
    const res = await post(nest, { ...validBody(), repoUrl: REPO_URL, confirmRepoAccess: true });
    const done = await waitUntilDone(nest, res.body.id);
    const everything = JSON.stringify([
      done.body,
      (await api(nest, `${res.body.id}/evidence`)).body,
      (await api(nest, `${res.body.id}/client-report`)).body,
      (await api(nest, `${res.body.id}/findings`)).body,
    ]);
    expect(everything).not.toContain(TOKEN);
  });
});

describe('a repository alone (no Supabase, no website)', () => {
  it('is accepted, has no Prover, and a clean repo is ready by these checks (the repo check is required, like a site check)', async () => {
    const nest = await build(zipOf({ name: 'o-r-1/a.ts', data: 'x' }));
    const res = await post(nest, { repoUrl: REPO_URL, confirmRepoAccess: true });
    expect(res.status).toBe(202);
    const done = await waitUntilDone(nest, res.body.id);
    expect(done.body.status).toBe('completed');
    expect(done.body.target).toEqual({ label: 'someone/app', repoUrl: REPO_URL });
    expect(done.body.gate).toEqual({ decision: 'ready_by_these_checks', reasons: [] });
  });

  it('a repo alone that has a key is not ready; one that could not be read is not ready and says so', async () => {
    const leaked = await build(
      zipOf({ name: 'o-r-1/c.ts', data: `const k = "${SECRET}"` }),
    );
    const a = await post(leaked, { repoUrl: REPO_URL, confirmRepoAccess: true });
    const aDone = await waitUntilDone(leaked, a.body.id);
    expect(aDone.body.gate.decision).toBe('not_ready');
    expect((aDone.body.gate.reasons as { en: string }[])[0].en).toMatch(/A leak was found/);
    await leaked.close();

    const failed = await build(failing(new RepoFetchError('RATE_LIMITED', 'x')));
    const b = await post(failed, { repoUrl: REPO_URL, confirmRepoAccess: true });
    const bDone = await waitUntilDone(failed, b.body.id);
    expect(bDone.body.gate.decision).toBe('not_ready');
    expect((bDone.body.gate.reasons as { en: string }[]).map((r) => r.en)).toContain(
      'Repo scan did not run.',
    );
  });
});

describe('flag off: nothing changes', () => {
  it('repoUrl is ignored (the old validation answers) and GitHub is never called', async () => {
    const transport = zipOf({ name: 'o-r-1/a.ts', data: 'x' }) as RepoTransport & {
      calls: { count: number };
    };
    const nest = await build(transport, AGENTS_OFF);
    const res = await post(nest, { repoUrl: REPO_URL, confirmRepoAccess: true });
    expect(res.status).toBe(400);
    const ok = await post(nest, { ...validBody(), repoUrl: REPO_URL, confirmRepoAccess: true });
    expect(ok.status).toBe(202);
    const done = await waitUntilDone(nest, ok.body.id);
    expect(transport.calls.count).toBe(0);
    expect(done.body.target.repoUrl).toBeUndefined();
    expect(done.body.summary.repoLeaked).toBeUndefined();
    expect((done.body.modules as { id: string }[]).map((m) => m.id)).not.toContain('repo-secrets');
  });
});
