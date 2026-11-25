import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createRepoInspectorAgent } from '../../src/agents/repo-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import {
  isTestPath,
  MAX_TEST_KEY_HITS,
  scanRepo,
  type RepoTransport,
} from '../../src/repo/repo-scanner.js';
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
import type { EvidenceItem } from '../../src/stages/types.js';
import { buildZip, type TestEntry } from './zip-builder.js';

// C3: a key found in a test path is INCONCLUSIVE (kind repo-test-key), never
// LEAKED and never a gate reason. The fake key is built from pieces at run
// time, so no key-like text sits in this file.
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
const withKey = (name: string, line = 1): TestEntry => ({
  name: `o-r-1/${name}`,
  data: `${'x\n'.repeat(line - 1)}const k = "${KEY}"`,
});

describe('isTestPath', () => {
  it('is true for the listed folders and file names', () => {
    for (const path of [
      'test/a.ts',
      'tests/a.ts',
      'src/__tests__/a.ts',
      'fixtures/a.json',
      'src/fixtures/a.json',
      'src/__mocks__/a.ts',
      'e2e/login.ts',
      'apps/web/e2e/login.ts',
      'src/a.test.ts',
      'src/a.spec.js',
      'src/a.test.tsx',
      'a.spec.ts',
      'src/Test/A.ts',
    ]) {
      expect(isTestPath(path), path).toBe(true);
    }
  });
  it('is false for everything else', () => {
    for (const path of [
      'src/a.ts',
      'src/latest/a.ts',
      'src/contest/a.ts',
      'src/testing.ts',
      'src/test-utils.ts',
      'src/attest.ts',
      'src/fixture/a.ts',
      '.env',
      'src/spec.ts',
      'src/inspect/a.ts',
    ]) {
      expect(isTestPath(path), path).toBe(false);
    }
  });
});

describe('scanRepo', () => {
  it('marks a hit by its path and keeps the line', async () => {
    const outcome = await scanRepo(
      zip(withKey('src/a.ts'), withKey('tests/b.ts', 3), withKey('src/c.spec.ts')),
      REPO,
    );
    expect(outcome.hits).toEqual([
      { path: 'src/a.ts', kind: 'secret-key', line: 1, testPath: false },
      { path: 'tests/b.ts', kind: 'secret-key', line: 3, testPath: true },
      { path: 'src/c.spec.ts', kind: 'secret-key', line: 1, testPath: true },
    ]);
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('lists at most MAX_TEST_KEY_HITS keys from test paths and says it is cut', async () => {
    const many = Array.from({ length: MAX_TEST_KEY_HITS + 3 }, (_, i) =>
      withKey(`test/f${i}.ts`),
    );
    const outcome = await scanRepo(zip(...many, withKey('src/real.ts')), REPO);
    expect(outcome.hits.filter((h) => h.testPath)).toHaveLength(MAX_TEST_KEY_HITS);
    expect(outcome.testHitsCut).toBe(true);
    // a real leak is never cut away by the test-path cap
    expect(outcome.hits.filter((h) => !h.testPath)).toHaveLength(1);
  });
});

describe('the repo inspector agent', () => {
  const run = async (...entries: TestEntry[]) => {
    const context: RunContext = { repoRef: REPO, siteResults: {}, provided };
    await createRepoInspectorAgent({ transport: zip(...entries) }).run(
      context,
      () => {},
      control(),
    );
    return context;
  };

  it('a key in a test path is INCONCLUSIVE, UNVERIFIED, kind repo-test-key, with a clear note', async () => {
    const context = await run(withKey('src/auth.test.ts', 2));
    expect(context.siteEvidence).toMatchObject([
      {
        check: REPO_CHECK_ID,
        kind: 'repo-test-key',
        verdict: 'INCONCLUSIVE',
        proof: 'UNVERIFIED',
        subject: 'src/auth.test.ts',
        line: 2,
      },
    ]);
    const item = context.siteEvidence![0];
    expect(item.summary.en).toContain('test path');
    expect(item.summary.en).toContain('not proven');
    expect(item.summary.ur).toContain('test ke path');
    expect(JSON.stringify(context)).not.toContain(KEY);
  });

  it('the same key outside a test path is still LEAKED', async () => {
    const context = await run(withKey('src/client.ts'), withKey('test/client.ts'));
    const items = context.siteEvidence ?? [];
    expect(items.map((i) => [i.kind, i.verdict, i.subject])).toEqual([
      ['repo-file', 'LEAKED', 'src/client.ts'],
      ['repo-test-key', 'INCONCLUSIVE', 'test/client.ts'],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it('a cut list is said in the coverage limits', async () => {
    const many = Array.from({ length: MAX_TEST_KEY_HITS + 1 }, (_, i) =>
      withKey(`test/f${i}.ts`),
    );
    const context = await run(...many);
    expect(context.siteEvidence).toHaveLength(MAX_TEST_KEY_HITS);
    expect(context.siteResults?.[REPO_CHECK_ID]?.limitNotes?.[0].en).toContain(
      'not complete',
    );
  });
});

describe('roadmap, gate and report for a test-path key', () => {
  const plan = planChecks(CHECKS, provided);
  const checks = checksFor(CHECKS, provided);
  const coverage = buildCoverage(
    checks,
    collectResults(checks, {
      findings: [],
      cleanup: null,
      dataAccess: { status: 'notProvided' },
      provided,
      siteResults: {
        [REPO_CHECK_ID]: { id: REPO_CHECK_ID, status: 'completed' },
      },
    }),
  );
  const testKey = {
    id: 'ev_site_repo-secrets_1',
    check: REPO_CHECK_ID,
    findingId: null,
    table: null,
    subject: 'test/auth.spec.ts',
    line: 4,
    kind: 'repo-test-key' as const,
    verdict: 'INCONCLUSIVE' as const,
    proof: 'UNVERIFIED' as const,
    summary: { en: 'x', ur: 'x' },
  };
  const roadmap = (evidence: EvidenceItem[] = [testKey]) => {
    const all = buildRoadmap({
      plan,
      findings: [],
      evidence,
      coverage,
      cleanup: null,
      provided,
    });
    return { ...all, items: all.items.filter((i) => i.kind !== 'provide-input') };
  };

  it('gives an improve-repo item, high (never critical), with a prompt and rotate-if-real steps', () => {
    const items = roadmap().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'improve-repo',
      severity: 'high',
      refs: { checkId: REPO_CHECK_ID, evidenceIds: [testKey.id] },
    });
    expect(items[0].title.en).toContain('test/auth.spec.ts');
    expect(items[0].steps.map((s) => s.en).join(' ')).toContain('rotate');
    expect(items[0].fixPrompt!.en).toContain('Show me the plan first');
    expect(items[0].fixPrompt!.ur).toContain('Pehle mujhe plan dikhao');
    expect(items[0].steps.length).toBeLessThanOrEqual(4);
  });

  it('a real leak still comes first', () => {
    const leak = {
      ...testKey,
      id: 'ev_2',
      kind: 'repo-file' as const,
      verdict: 'LEAKED' as const,
    };
    expect(roadmap([testKey, leak]).items.map((i) => i.kind)).toEqual([
      'fix-repo-secret',
      'improve-repo',
    ]);
  });

  it('never makes the gate not_ready by itself', () => {
    const without = evaluateGate({ plan, coverage, evidence: [], cleanup: null });
    const withKey = evaluateGate({ plan, coverage, evidence: [testKey], cleanup: null });
    expect(withKey).toEqual(without);
  });

  it('is not counted as a leak in the client report', () => {
    const gate = evaluateGate({ plan, coverage, evidence: [testKey], cleanup: null });
    const report = buildClientReport({
      plan,
      evidence: [testKey],
      coverage,
      gate,
      roadmap: null,
    });
    expect(report.findings.repo).toEqual({ leaked: 0 });
  });
});
