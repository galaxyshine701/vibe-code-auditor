import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createRepoInspectorAgent } from '../../src/agents/repo-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import {
  findSecretVariables,
  isEnvFile,
  isPlaceholderValue,
  isSecretName,
  MAX_ENV_FILE_HITS,
  MAX_NAMES_PER_FILE,
} from '../../src/repo/env-file-rules.js';
import { scanRepo, type RepoTransport } from '../../src/repo/repo-scanner.js';
import { buildClientReport } from '../../src/stages/client-report.js';
import { buildCoverage } from '../../src/stages/evidence.js';
import { evaluateGate } from '../../src/stages/gate.js';
import { collectResults } from '../../src/stages/inspectors.js';
import {
  CHECKS,
  REPO_CHECK_ID,
  checksFor,
} from '../../src/stages/planner-config.js';
import { planChecks } from '../../src/stages/planner.js';
import { buildRoadmap } from '../../src/stages/roadmap.js';
import { buildZip, type TestEntry } from './zip-builder.js';

// C2 (rule 3): a committed env file with a secret-looking NAME and a value is a
// warning (INCONCLUSIVE, kind repo-env-file). Only the names and the path are
// shown, never a value. Values are built from pieces so no key-like text sits
// in this source.
const VALUE = 'hunter2' + 'Zq81' + 'LmN0pR';
const OTHER = 'plainpass' + 'word99';
const KEY = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0';
const REPO = { owner: 'someone', repo: 'app' };
const provided = { website: false, supabase: false, repo: true };

const control = (): AgentControl => ({
  shouldStop: () => false,
  redact: (t) => t,
  states: () => [],
  failure: () => null,
});
const zip = (...entries: TestEntry[]): RepoTransport => ({
  fetchArchive: () => Promise.resolve(buildZip(entries)),
});

describe('isEnvFile', () => {
  it('is true for .env and .env.<something>', () => {
    for (const p of ['.env', '.env.local', '.env.production', 'api/.env', 'apps/web/.env.development.local']) {
      expect(isEnvFile(p), p).toBe(true);
    }
  });
  it('is false for example, sample and template files and for other names', () => {
    for (const p of [
      '.env.example',
      '.env.sample',
      '.env.template',
      '.env.local.example',
      'backend/.env.example',
      '.ENV.EXAMPLE',
      'env.ts',
      'config.env.ts',
      'src/.environment',
      'README.md',
    ]) {
      expect(isEnvFile(p), p).toBe(false);
    }
  });
});

describe('isSecretName', () => {
  it('says yes to names that say secret, password, token, API key and the like', () => {
    for (const n of [
      'JWT_SECRET',
      'DB_PASSWORD',
      'STRIPE_API_KEY',
      'GITHUB_TOKEN',
      'SUPABASE_SERVICE_ROLE_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'PRIVATE_KEY',
      'api_key',
      'SESSION_SECRET',
    ]) {
      expect(isSecretName(n), n).toBe(true);
    }
  });
  it('says no to ordinary and public names', () => {
    for (const n of [
      'SUPABASE_URL',
      'PORT',
      'NODE_ENV',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'STRIPE_PUBLIC_KEY',
      'TOKENIZER_MODE',
      'KEYBOARD_LAYOUT',
      'A'.repeat(70) + '_SECRET',
    ]) {
      expect(isSecretName(n), n).toBe(false);
    }
  });
});

describe('isPlaceholderValue', () => {
  it('is true for empty and example values', () => {
    for (const v of ['', ' ', 'xxxxxxxx', 'your_api_key_here', 'YOUR-KEY', 'example', 'changeme', 'change_me', '<token>', '...', '${OTHER}', '$OTHER', 'replace-me', 'placeholder']) {
      expect(isPlaceholderValue(v), v).toBe(true);
    }
  });
  it('is false for a real-looking value', () => {
    expect(isPlaceholderValue(VALUE)).toBe(false);
  });
});

describe('findSecretVariables', () => {
  it('gives the first line and the names, never a value', () => {
    const found = findSecretVariables(
      `# comment\nPORT=3000\nJWT_SECRET=${VALUE}\nexport DB_PASSWORD="${OTHER}"\nAPI_TOKEN='${VALUE}' # note\n`,
    );
    expect(found).toEqual({ line: 3, names: ['JWT_SECRET', 'DB_PASSWORD', 'API_TOKEN'], more: 0 });
    expect(JSON.stringify(found)).not.toContain(VALUE);
    expect(JSON.stringify(found)).not.toContain(OTHER);
  });
  it('skips comments, empty values, examples, short values, numbers and flags', () => {
    expect(
      findSecretVariables(
        [
          `# JWT_SECRET=${VALUE}`,
          'JWT_SECRET=',
          'JWT_SECRET=""',
          'DB_PASSWORD=your_password_here',
          'API_TOKEN=changeme',
          'SESSION_SECRET=abc',
          'TOKEN_TTL=3600',
          'SECRET_ENABLED=true',
          'API_KEY=${OTHER_KEY}',
        ].join('\n'),
      ),
    ).toBeNull();
  });
  it('names at most MAX_NAMES_PER_FILE and counts the rest', () => {
    const lines = Array.from({ length: MAX_NAMES_PER_FILE + 3 }, (_, i) => `S${i}_SECRET=${VALUE}`);
    const found = findSecretVariables(lines.join('\n'))!;
    expect(found.names).toHaveLength(MAX_NAMES_PER_FILE);
    expect(found.more).toBe(3);
  });
  it('leaves a line with a known key format to the key rule', () => {
    expect(findSecretVariables(`SUPABASE_SECRET=${KEY}`)).toBeNull();
    // the next line, without a key, is still found
    expect(findSecretVariables(`SUPABASE_SECRET=${KEY}\nJWT_SECRET=${VALUE}`)).toMatchObject({
      line: 2,
      names: ['JWT_SECRET'],
    });
  });
  it('leaves a NEXT_PUBLIC_ / VITE_ name that says SECRET to rule 2', () => {
    expect(findSecretVariables(`NEXT_PUBLIC_API_SECRET=${VALUE}`)).toBeNull();
    expect(findSecretVariables(`VITE_X_SERVICE_ROLE=${VALUE}`)).toBeNull();
  });
});

describe('scanRepo and the agent', () => {
  it('reads a committed .env and not an example file', async () => {
    const outcome = await scanRepo(
      zip(
        { name: 'o-r-1/.env', data: `JWT_SECRET=${VALUE}\n` },
        { name: 'o-r-1/.env.example', data: `JWT_SECRET=${VALUE}\n` },
        { name: 'o-r-1/.env.sample', data: `JWT_SECRET=${VALUE}\n` },
        { name: 'o-r-1/.env.template', data: `JWT_SECRET=${VALUE}\n` },
        { name: 'o-r-1/src/config.ts', data: `const JWT_SECRET = "${VALUE}"` },
      ),
      REPO,
    );
    expect(outcome.envHits).toEqual([
      { path: '.env', line: 1, names: ['JWT_SECRET'], more: 0 },
    ]);
    expect(JSON.stringify(outcome)).not.toContain(VALUE);
  });

  const run = async (...entries: TestEntry[]) => {
    const context: RunContext = { repoRef: REPO, siteResults: {}, provided };
    await createRepoInspectorAgent({ transport: zip(...entries) }).run(context, () => {}, control());
    return context;
  };

  it('the evidence is INCONCLUSIVE, UNVERIFIED, kind repo-env-file, with names and path only', async () => {
    const context = await run({
      name: 'o-r-1/api/.env.production',
      data: `PORT=1\nJWT_SECRET=${VALUE}\nDB_PASSWORD=${OTHER}\n`,
    });
    expect(context.siteEvidence).toMatchObject([
      {
        check: REPO_CHECK_ID,
        kind: 'repo-env-file',
        verdict: 'INCONCLUSIVE',
        proof: 'UNVERIFIED',
        subject: 'api/.env.production',
        line: 2,
      },
    ]);
    const summary = context.siteEvidence![0].summary;
    expect(summary.en).toContain('JWT_SECRET, DB_PASSWORD');
    expect(summary.en).toContain('not a proven leak');
    expect(summary.ur).toContain('JWT_SECRET, DB_PASSWORD');
    expect(JSON.stringify(context)).not.toContain(VALUE);
    expect(JSON.stringify(context)).not.toContain(OTHER);
  });

  it('a value with a known key format follows the key rule: LEAKED, and no env-file item for that line', async () => {
    const context = await run({ name: 'o-r-1/.env', data: `SUPABASE_SECRET=${KEY}\n` });
    expect((context.siteEvidence ?? []).map((i) => [i.kind, i.verdict])).toEqual([
      ['repo-file', 'LEAKED'],
    ]);
    expect(JSON.stringify(context)).not.toContain(KEY);
  });

  it('ids do not clash with the other kinds', async () => {
    const context = await run(
      { name: 'o-r-1/src/a.ts', data: `const k = "${KEY}"` },
      { name: 'o-r-1/test/a.ts', data: `const k = "${KEY}"` },
      { name: 'o-r-1/.env', data: `JWT_SECRET=${VALUE}` },
      { name: 'o-r-1/b.env', data: 'VITE_X_SECRET=1' },
    );
    const items = context.siteEvidence ?? [];
    expect(items.map((i) => i.kind)).toEqual([
      'repo-file',
      'repo-test-key',
      'repo-env-file',
      'repo-env-name',
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(4);
  });

  it('lists at most MAX_ENV_FILE_HITS files and says so in the limits', async () => {
    const many = Array.from({ length: MAX_ENV_FILE_HITS + 1 }, (_, i) => ({
      name: `o-r-1/p${i}/.env`,
      data: `JWT_SECRET=${VALUE}`,
    }));
    const context = await run(...many);
    expect(context.siteEvidence).toHaveLength(MAX_ENV_FILE_HITS);
    expect(context.siteResults?.[REPO_CHECK_ID]?.limitNotes?.[0].en).toContain('not complete');
  });
});

describe('roadmap, gate and report for a committed env file', () => {
  const plan = planChecks(CHECKS, provided);
  const checks = checksFor(CHECKS, provided);
  const coverage = buildCoverage(
    checks,
    collectResults(checks, {
      findings: [],
      cleanup: null,
      dataAccess: { status: 'notProvided' },
      provided,
      siteResults: { [REPO_CHECK_ID]: { id: REPO_CHECK_ID, status: 'completed' } },
    }),
  );
  const envFile = {
    id: 'ev_site_repo-secrets_1',
    check: REPO_CHECK_ID,
    findingId: null,
    table: null,
    subject: '.env',
    line: 2,
    kind: 'repo-env-file' as const,
    verdict: 'INCONCLUSIVE' as const,
    proof: 'UNVERIFIED' as const,
    summary: { en: 'x', ur: 'x' },
  };
  const items = buildRoadmap({ plan, findings: [], evidence: [envFile], coverage, cleanup: null, provided })
    .items.filter((i) => i.kind !== 'provide-input');

  it('gives an improve-repo item, high (never critical), with a prompt', () => {
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'improve-repo',
      severity: 'high',
      refs: { checkId: REPO_CHECK_ID, evidenceIds: [envFile.id] },
    });
    const steps = items[0].steps.map((s) => s.en).join(' ');
    expect(steps).toContain('Rotate every real secret');
    expect(steps).toContain('.gitignore');
    expect(items[0].fixPrompt!.en).toContain('Show me the plan first');
    expect(items[0].fixPrompt!.en).toContain('Do not print the values');
    expect(items[0].fixPrompt!.ur).toContain('Pehle mujhe plan dikhao');
  });

  it('never makes the gate not_ready by itself, and is not counted as a leak', () => {
    const without = evaluateGate({ plan, coverage, evidence: [], cleanup: null });
    const gate = evaluateGate({ plan, coverage, evidence: [envFile], cleanup: null });
    expect(gate).toEqual(without);
    const report = buildClientReport({ plan, evidence: [envFile], coverage, gate, roadmap: null });
    expect(report.findings.repo).toEqual({ leaked: 0 });
  });
});
