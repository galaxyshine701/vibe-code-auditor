import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createRepoInspectorAgent } from '../../src/agents/repo-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import type { RepoTransport } from '../../src/repo/repo-scanner.js';
import { buildCoverage } from '../../src/stages/evidence.js';
import { collectResults } from '../../src/stages/inspectors.js';
import {
  CHECKS,
  REPO_CHECK_ID,
  checksFor,
} from '../../src/stages/planner-config.js';
import type { CheckResult } from '../../src/stages/types.js';
import { buildZip, type TestEntry } from './zip-builder.js';

// C4: the number of files the Repo scan read goes to coverage.filesRead. It is
// optional and additive: a check that gives no count adds nothing.
const REPO = { owner: 'someone', repo: 'app' };
const provided = { website: false, supabase: false, repo: true };
const checks = checksFor(CHECKS, provided);
const control = (): AgentControl => ({
  shouldStop: () => false,
  redact: (t) => t,
  states: () => [],
  failure: () => null,
});
const zip = (...entries: TestEntry[]): RepoTransport => ({
  fetchArchive: () => Promise.resolve(buildZip(entries)),
});

function coverageFrom(context: RunContext) {
  return buildCoverage(
    checks,
    collectResults(checks, {
      findings: [],
      cleanup: null,
      dataAccess: { status: 'notProvided' },
      provided,
      siteResults: context.siteResults,
    }),
  );
}

async function coverageOf(...entries: TestEntry[]) {
  const context: RunContext = { repoRef: REPO, siteResults: {}, provided };
  await createRepoInspectorAgent({ transport: zip(...entries) }).run(
    context,
    () => {},
    control(),
  );
  return coverageFrom(context);
}

describe('coverage.filesRead', () => {
  it('is the number of text files the Repo scan looked at', async () => {
    const coverage = await coverageOf(
      { name: 'o-r-1/a.ts', data: 'export {}' },
      { name: 'o-r-1/b.json', data: '{}' },
      { name: 'o-r-1/node_modules/x/index.js', data: 'x' },
      { name: 'o-r-1/logo.png', data: 'x' },
    );
    expect(coverage.filesRead).toEqual([{ id: REPO_CHECK_ID, count: 2 }]);
  });

  it('a binary file with a text name is not counted', async () => {
    const coverage = await coverageOf(
      { name: 'o-r-1/a.ts', data: 'export {}' },
      { name: 'o-r-1/b.json', data: Buffer.from([0x7b, 0x00, 0x7d]) },
    );
    expect(coverage.filesRead).toEqual([{ id: REPO_CHECK_ID, count: 1 }]);
  });

  it('a repository with no text file says 0, not "missing"', async () => {
    const coverage = await coverageOf({ name: 'o-r-1/logo.png', data: 'x' });
    expect(coverage.filesRead).toEqual([{ id: REPO_CHECK_ID, count: 0 }]);
  });

  it('a partial check still gives its count', async () => {
    const big = Buffer.alloc(1024 * 1024 + 10, 'a');
    const coverage = await coverageOf(
      { name: 'o-r-1/a.ts', data: 'export {}' },
      { name: 'o-r-1/big.json', data: big },
    );
    expect(coverage.partial.map((p) => p.id)).toContain(REPO_CHECK_ID);
    expect(coverage.filesRead).toEqual([{ id: REPO_CHECK_ID, count: 1 }]);
  });

  it('a repository that could not be read has no count (never an invented 0)', async () => {
    const context: RunContext = { repoRef: REPO, siteResults: {}, provided };
    await createRepoInspectorAgent({
      transport: { fetchArchive: () => Promise.reject(new Error('x')) },
    }).run(context, () => {}, control());
    const coverage = coverageFrom(context);
    expect(coverage.failedToRun.map((f) => f.id)).toContain(REPO_CHECK_ID);
    expect('filesRead' in coverage).toBe(false);
  });

  it('a run without a repository has no filesRead key at all', () => {
    const noRepo = checksFor(CHECKS, { website: true, supabase: true });
    const coverage = buildCoverage(
      noRepo,
      collectResults(noRepo, {
        findings: [],
        cleanup: null,
        dataAccess: { status: 'notProvided' },
        provided: { website: true, supabase: true },
      }),
    );
    expect('filesRead' in coverage).toBe(false);
  });

  it('ignores a count that is not a whole number of 0 or more', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result: CheckResult = {
        id: REPO_CHECK_ID,
        status: 'completed',
        filesRead: bad,
      };
      const coverage = buildCoverage(checks, [result]);
      expect('filesRead' in coverage).toBe(false);
    }
  });
});
