import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createRepoInspectorAgent } from '../../src/agents/repo-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import {
  findPublicSecretName,
  MAX_NAME_HITS,
  scanRepo,
  type RepoTransport,
} from '../../src/repo/repo-scanner.js';
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
import { buildClientReport } from '../../src/stages/client-report.js';
import { buildZip, type TestEntry } from './zip-builder.js';

// Rule 2 of Repo Scan: a variable named NEXT_PUBLIC_ or VITE_ that says SECRET
// or SERVICE_ROLE. A name is only a warning sign: INCONCLUSIVE, kind
// improve-repo (high), and it never holds the gate back by itself.
// Values are built from pieces so no key-like text sits in this source.
const SECRET = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0';
const VALUE = 'topsecretvalue' + 'ABCDEF123456';
const REPO = { owner: 'someone', repo: 'app' };

const control = (): AgentControl => ({
  shouldStop: () => false,
  redact: (t) => t,
  states: () => [],
  failure: () => null,
});
const zip = (...entries: TestEntry[]): RepoTransport => ({
  fetchArchive: () => Promise.resolve(buildZip(entries)),
});

describe('findPublicSecretName', () => {
  it('finds NEXT_PUBLIC_ and VITE_ names with SECRET or SERVICE_ROLE, and gives the line', () => {
    expect(findPublicSecretName('a\nNEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=x')).toBe(2);
    expect(findPublicSecretName('const k = import.meta.env.VITE_SUPABASE_SECRET')).toBe(1);
    expect(findPublicSecretName('NEXT_PUBLIC_API_SECRET_TOKEN=1')).toBe(1);
  });
  it('does not fire on the normal public names or on server-only names', () => {
    expect(findPublicSecretName('NEXT_PUBLIC_SUPABASE_URL=x')).toBeNull();
    expect(findPublicSecretName('NEXT_PUBLIC_SUPABASE_ANON_KEY=x')).toBeNull();
    expect(findPublicSecretName('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x')).toBeNull();
    expect(findPublicSecretName('SUPABASE_SERVICE_ROLE_KEY=x')).toBeNull();
    expect(findPublicSecretName('SECRET_NEXT_PUBLIC_X=x')).toBeNull();
    expect(findPublicSecretName('MY_NEXT_PUBLIC_SECRET=x')).toBeNull();
    expect(findPublicSecretName('next_public_secret=x')).toBeNull();
  });
  it('leaves out a line that holds a recognised key (the key rule reports it)', () => {
    expect(findPublicSecretName(`NEXT_PUBLIC_SUPABASE_SECRET=${SECRET}`)).toBeNull();
    // the next name, on another line without a key, is still found
    expect(
      findPublicSecretName(`NEXT_PUBLIC_A_SECRET=${SECRET}\nVITE_B_SECRET=ok`),
    ).toBe(2);
  });
});

describe('scanRepo: public secret names', () => {
  it('one hit per code or config file with path and line, never the value', async () => {
    const outcome = await scanRepo(
      zip(
        { name: 'o-r-1/.env.example', data: `NEXT_PUBLIC_SERVICE_ROLE=${VALUE}\n` },
        { name: 'o-r-1/src/a.ts', data: `x\nconst a = process.env.VITE_X_SECRET\nconst b = process.env.VITE_Y_SECRET` },
        { name: 'o-r-1/README.md', data: 'Set NEXT_PUBLIC_SUPABASE_SECRET in your env' },
        { name: 'o-r-1/notes.txt', data: 'VITE_SECRET_ONE' },
        { name: 'o-r-1/src/ok.ts', data: 'export {}' },
      ),
      REPO,
    );
    expect(outcome.nameHits).toEqual([
      { path: '.env.example', line: 1 },
      { path: 'src/a.ts', line: 2 },
    ]);
    expect(outcome.hits).toEqual([]);
    expect(JSON.stringify(outcome)).not.toContain(VALUE);
  });
  it('a key on the same line is reported by the key rule only', async () => {
    const outcome = await scanRepo(
      zip({ name: 'o-r-1/.env', data: `NEXT_PUBLIC_SECRET=${SECRET}` }),
      REPO,
    );
    expect(outcome.hits).toEqual([{ path: '.env', kind: 'secret-key', line: 1 }]);
    expect(outcome.nameHits).toEqual([]);
  });
  it('lists at most MAX_NAME_HITS files', async () => {
    const entries = Array.from({ length: MAX_NAME_HITS + 5 }, (_, i) => ({
      name: `o-r-1/f${i}.env`,
      data: 'VITE_A_SECRET=1',
    }));
    const outcome = await scanRepo(zip(...entries), REPO);
    expect(outcome.nameHits).toHaveLength(MAX_NAME_HITS);
    expect(outcome.nameHitsCut).toBe(true);
  });
  it('exactly MAX_NAME_HITS files is not a cut', async () => {
    const entries = Array.from({ length: MAX_NAME_HITS }, (_, i) => ({
      name: `o-r-1/f${i}.env`,
      data: 'VITE_A_SECRET=1',
    }));
    const outcome = await scanRepo(zip(...entries), REPO);
    expect(outcome.nameHits).toHaveLength(MAX_NAME_HITS);
    expect(outcome.nameHitsCut).toBe(false);
  });
});

describe('the repo inspector agent: name evidence', () => {
  const run = async (...entries: TestEntry[]) => {
    const context: RunContext = {
      repoRef: REPO,
      siteResults: {},
      provided: { website: false, supabase: false, repo: true },
    };
    await createRepoInspectorAgent({ transport: zip(...entries) }).run(
      context,
      () => {},
      control(),
    );
    return context;
  };

  it('a name is INCONCLUSIVE and UNVERIFIED, kind repo-env-name, path and line only', async () => {
    const context = await run({
      name: 'o-r-1/.env.local',
      data: `NEXT_PUBLIC_SERVICE_ROLE_KEY=${VALUE}`,
    });
    expect(context.siteResults?.[REPO_CHECK_ID]).toEqual({
      id: REPO_CHECK_ID,
      status: 'completed',
    });
    expect(context.siteEvidence).toMatchObject([
      {
        check: REPO_CHECK_ID,
        kind: 'repo-env-name',
        verdict: 'INCONCLUSIVE',
        proof: 'UNVERIFIED',
        subject: '.env.local',
        line: 1,
      },
    ]);
    expect(JSON.stringify(context)).not.toContain(VALUE);
  });

  it('a key and a name together: LEAKED first, ids do not clash', async () => {
    const context = await run(
      { name: 'o-r-1/a.ts', data: `const k = "${SECRET}"` },
      { name: 'o-r-1/b.env', data: 'VITE_X_SECRET=1' },
    );
    const items = context.siteEvidence ?? [];
    expect(items.map((i) => i.kind)).toEqual(['repo-file', 'repo-env-name']);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
    expect(JSON.stringify(context)).not.toContain(SECRET);
  });
});

describe('a cut list is said in the report limits, and does not hold the gate', () => {
  const provided = { website: false, supabase: false, repo: true };
  const plan = planChecks(CHECKS, provided);
  const checks = checksFor(CHECKS, provided);
  const run = async (count: number) => {
    const context: RunContext = {
      repoRef: REPO,
      siteResults: {},
      provided,
    };
    const entries = Array.from({ length: count }, (_, i) => ({
      name: `o-r-1/f${i}.env`,
      data: 'VITE_A_SECRET=1',
    }));
    await createRepoInspectorAgent({ transport: zip(...entries) }).run(
      context,
      () => {},
      control(),
    );
    const coverage = buildCoverage(
      checks,
      collectResults(checks, {
        findings: [],
        cleanup: null,
        dataAccess: { status: 'notProvided' },
        provided,
        siteResults: context.siteResults,
      }),
    );
    return { context, coverage };
  };

  it('more than the cap: the check is completed and the limits say the list is not complete', async () => {
    const { context, coverage } = await run(MAX_NAME_HITS + 1);
    expect(context.siteEvidence).toHaveLength(MAX_NAME_HITS);
    expect(coverage.checked).toContain(REPO_CHECK_ID);
    const limits = coverage.limits.map((l) => l.en).join('\n');
    expect(limits).toContain('is not complete');
    expect(limits).toContain(`first ${MAX_NAME_HITS} files`);
    expect(coverage.limits.map((l) => l.ur).join('\n')).toContain('mukammal nahi');
    const gate = evaluateGate({ plan, coverage, evidence: context.siteEvidence ?? [], cleanup: null });
    expect(gate.decision).toBe('ready_by_these_checks');
  });

  it('at or under the cap: no such line', async () => {
    const { coverage } = await run(MAX_NAME_HITS);
    expect(coverage.limits.map((l) => l.en).join('\n')).not.toContain('is not complete');
  });

  it('the fixed limits say only UPPERCASE names are checked and .md/.txt are skipped', async () => {
    const { coverage } = await run(1);
    const line = coverage.limits.map((l) => l.en).find((l) => l.includes('UPPERCASE'));
    expect(line).toBeDefined();
    expect(line).toContain('.md and .txt files are skipped');
    expect(coverage.limits.map((l) => l.ur).join('\n')).toContain('UPPERCASE');
  });
});

describe('roadmap, gate and report for a name', () => {
  const provided = { website: false, supabase: false, repo: true };
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
  const name = {
    id: 'ev_site_repo-secrets_1',
    check: REPO_CHECK_ID,
    findingId: null,
    table: null,
    subject: 'src/config.ts',
    line: 4,
    kind: 'repo-env-name' as const,
    verdict: 'INCONCLUSIVE' as const,
    proof: 'UNVERIFIED' as const,
    summary: { en: 'x', ur: 'x' },
  };
  const roadmap = (evidence = [name]) => {
    const all = buildRoadmap({ plan, findings: [], evidence, coverage, cleanup: null, provided });
    // the optional checks that were not given add provide-input items: not under test here
    return { ...all, items: all.items.filter((i) => i.kind !== 'provide-input') };
  };

  it('gives an improve-repo item, high, with its own prompt and no key', () => {
    const items = roadmap().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'improve-repo',
      severity: 'high',
      fromRequiredCheck: true,
      refs: { checkId: REPO_CHECK_ID, evidenceIds: [name.id] },
    });
    expect(items[0].title.en).toContain('src/config.ts');
    expect(items[0].steps.length).toBeLessThanOrEqual(4);
    expect(items[0].fixPrompt!.en).toContain('NEXT_PUBLIC_ or VITE_');
    expect(items[0].fixPrompt!.en).toContain('Show me the plan first');
    expect(items[0].fixPrompt!.ur).toContain('Pehle mujhe plan dikhao');
    expect(items[0].severity).not.toBe('critical');
  });

  it('a LEAKED key still comes before a name', () => {
    const leak = { ...name, id: 'ev_2', kind: 'repo-file' as const, verdict: 'LEAKED' as const };
    expect(roadmap([name, leak]).items.map((i) => i.kind)).toEqual([
      'fix-repo-secret',
      'improve-repo',
    ]);
  });

  it('never makes the gate not_ready by itself', () => {
    const without = evaluateGate({ plan, coverage, evidence: [], cleanup: null });
    const withName = evaluateGate({ plan, coverage, evidence: [name], cleanup: null });
    expect(withName).toEqual(without);
    expect(withName.decision).toBe('ready_by_these_checks');
  });

  it('is not counted as a leak in the client report', () => {
    const gate = evaluateGate({ plan, coverage, evidence: [name], cleanup: null });
    const report = buildClientReport({ plan, evidence: [name], coverage, gate, roadmap: null });
    expect(report.findings.repo).toEqual({ leaked: 0 });
  });
});
