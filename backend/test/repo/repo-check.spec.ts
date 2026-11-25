import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createRepoInspectorAgent } from '../../src/agents/repo-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import { createGithubTransport } from '../../src/repo/github-transport.js';
import { RepoFetchError, type RepoTransport } from '../../src/repo/repo-scanner.js';
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
import { buildZip } from './zip-builder.js';

const SECRET = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0';
const TOKEN = 'github_pat_' + 'NEVERLOGTHISTOKEN12345';
const REPO = { owner: 'someone', repo: 'app' };

const control = (over: Partial<AgentControl> = {}): AgentControl => ({
  shouldStop: () => false,
  redact: (t) => t,
  states: () => [],
  failure: () => null,
  ...over,
});
const contextWithRepo = (): RunContext => ({
  repoRef: REPO,
  siteResults: {},
  provided: { website: false, supabase: true, repo: true },
});
const zipTransport = (...entries: Parameters<typeof buildZip>[0]): RepoTransport => ({
  fetchArchive: () => Promise.resolve(buildZip(entries)),
});

describe('the plan: the repo check exists only when a repository was given', () => {
  const ids = (plan: { id: string }[]) => plan.map((c) => c.id);

  it('a run without a repo has exactly the checks it always had', () => {
    const before = ids(planChecks());
    expect(before).toEqual(CHECKS.map((c) => c.id));
    expect(ids(planChecks(CHECKS, { website: true, supabase: true }))).toEqual(before);
    expect(
      ids(planChecks(CHECKS, { website: true, supabase: true, repo: false })),
    ).toEqual(before);
  });

  it('a run with a repo gets one more check, and it is required (like a site check that was given)', () => {
    const plan = planChecks(CHECKS, { website: false, supabase: true, repo: true });
    expect(ids(plan)).toEqual([...CHECKS.map((c) => c.id), REPO_CHECK_ID]);
    expect(plan.find((c) => c.id === REPO_CHECK_ID)?.required).toBe(true);
    expect(checksFor(CHECKS, undefined)).toBe(CHECKS);
  });
});

describe('the gate says so when a provided repo scan did not run (condition 4)', () => {
  const prover = CHECKS[0];
  const planWith = (repo: boolean) =>
    planChecks(CHECKS, { website: false, supabase: true, repo });
  const blocked: EvidenceItem = {
    id: 'ev_1',
    check: 'data-access-prover',
    findingId: 'f1',
    table: 't',
    verdict: 'BLOCKED',
    proof: 'PROVEN',
    summary: { en: 'x', ur: 'x' },
  };
  const coverage = (over: object = {}) => ({
    checked: [prover.id],
    partial: [],
    skipped: [],
    outOfScope: [],
    failedToRun: [],
    nothingToTest: [],
    limits: [],
    ...over,
  });
  const gate = (repo: boolean, cov: object = {}) =>
    evaluateGate({
      plan: planWith(repo),
      coverage: coverage(cov),
      evidence: [blocked],
      cleanup: 'ok',
    });

  it('today (the finding behind this rule): a failed optional check alone does not hold the gate', () => {
    // a website check that is optional in this plan: failing does not matter
    const result = evaluateGate({
      plan: planWith(false).map((c) => ({ ...c, required: c.id === prover.id })),
      coverage: coverage({
        failedToRun: [{ id: 'bundle-secrets', reason: { en: 'x', ur: 'x' } }],
      }),
      evidence: [blocked],
      cleanup: 'ok',
    });
    expect(result.decision).toBe('ready_by_these_checks');
  });

  it('no repo given: the gate is exactly as before', () => {
    expect(gate(false)).toEqual({ decision: 'ready_by_these_checks', reasons: [] });
  });

  it('repo given and scanned: ready', () => {
    expect(gate(true, { checked: [prover.id, REPO_CHECK_ID] }).decision).toBe(
      'ready_by_these_checks',
    );
  });

  it('repo given and failed to run: not ready, "Repo scan did not run."', () => {
    const result = gate(true, {
      failedToRun: [{ id: REPO_CHECK_ID, reason: { en: 'x', ur: 'x' } }],
    });
    expect(result.decision).toBe('not_ready');
    expect(result.reasons.map((r) => r.en)).toEqual(['Repo scan did not run.']);
  });

  it('repo given and only partly read: not ready, says partly done', () => {
    const result = gate(true, {
      partial: [{ id: REPO_CHECK_ID, reason: { en: 'x', ur: 'x' }, notRead: [] }],
    });
    expect(result.decision).toBe('not_ready');
    expect(result.reasons[0].en).toMatch(/Repo scan was only partly done/);
  });

  it('repo given and a key found: not ready (a leak)', () => {
    const result = evaluateGate({
      plan: planWith(true),
      coverage: coverage({ checked: [prover.id, REPO_CHECK_ID] }),
      evidence: [
        blocked,
        { ...blocked, id: 'ev_r', check: REPO_CHECK_ID, kind: 'repo-file', verdict: 'LEAKED' },
      ],
      cleanup: 'ok',
    });
    expect(result.decision).toBe('not_ready');
  });
});

describe('the repo inspector agent', () => {
  it('a key in a file is LEAKED evidence with the path only, and the check is completed', async () => {
    const context = contextWithRepo();
    await createRepoInspectorAgent({
      transport: zipTransport(
        { name: 'o-r-1/src/client.ts', data: `const k = "${SECRET}"` },
        { name: 'o-r-1/ok.ts', data: 'export {}' },
      ),
    }).run(context, () => {}, control());
    expect(context.siteResults?.[REPO_CHECK_ID]).toEqual({
      id: REPO_CHECK_ID,
      status: 'completed',
      filesRead: 2,
    });
    expect(context.siteEvidence).toMatchObject([
      { check: REPO_CHECK_ID, kind: 'repo-file', verdict: 'LEAKED', proof: 'PROVEN', subject: 'src/client.ts', line: 1 },
    ]);
    expect(JSON.stringify(context)).not.toContain(SECRET);
  });

  it('a clean repo is completed with no evidence', async () => {
    const context = contextWithRepo();
    await createRepoInspectorAgent({
      transport: zipTransport({ name: 'o-r-1/a.ts', data: 'x' }),
    }).run(context, () => {}, control());
    expect(context.siteResults?.[REPO_CHECK_ID]?.status).toBe('completed');
    expect(context.siteEvidence ?? []).toEqual([]);
  });

  it('a link or a too-big file makes the check partial and names it', async () => {
    const context = contextWithRepo();
    await createRepoInspectorAgent({
      transport: zipTransport(
        { name: 'o-r-1/link.ts', data: 'x', mode: 0o120777 },
        { name: 'o-r-1/b.json', data: Buffer.alloc(1024 * 1024 + 1, 97) },
      ),
    }).run(context, () => {}, control());
    const result = context.siteResults?.[REPO_CHECK_ID];
    expect(result?.status).toBe('partial');
    expect(result?.notRead?.map((n) => n.name).sort()).toEqual(['b.json', 'link.ts']);
  });

  it.each([
    ['NOT_FOUND', /not found, or it is private/],
    ['RATE_LIMITED', /GitHub refused the request/],
    ['TOO_LARGE', /larger than the allowed size/],
    ['FAILED', /could not be fetched/],
  ] as const)('a %s failure is failedToRun with a clear fixed message', async (code, text) => {
    const context = contextWithRepo();
    await createRepoInspectorAgent({
      transport: { fetchArchive: () => Promise.reject(new RepoFetchError(code, 'internal')) },
    }).run(context, () => {}, control());
    const result = context.siteResults?.[REPO_CHECK_ID];
    expect(result?.status).toBe('failedToRun');
    expect(result?.reason?.en).toMatch(text);
    expect(result?.reason?.en).not.toContain('internal');
  });

  it('a hostile zip is failedToRun (archive refused)', async () => {
    const context = contextWithRepo();
    await createRepoInspectorAgent({
      transport: zipTransport({ name: '../evil.ts', data: 'x' }),
    }).run(context, () => {}, control());
    expect(context.siteResults?.[REPO_CHECK_ID]?.reason?.en).toMatch(/limits of the scan/);
  });

  it('a stopped run does not start the download', async () => {
    const context = contextWithRepo();
    let called = false;
    await createRepoInspectorAgent({
      transport: { fetchArchive: () => ((called = true), Promise.resolve(Buffer.alloc(0))) },
    }).run(context, () => {}, control({ shouldStop: () => true }));
    expect(called).toBe(false);
    expect(context.siteResults?.[REPO_CHECK_ID]?.status).toBe('failedToRun');
  });

  it('no repo in the context: skipped as not provided', async () => {
    const outcome = await createRepoInspectorAgent({
      transport: zipTransport(),
    }).run({ siteResults: {} }, () => {}, control());
    expect(outcome).toMatchObject({ skipped: { en: expect.stringContaining('Not provided') } });
  });
});

describe('GITHUB_TOKEN is never logged, stored or returned (never-log test)', () => {
  it('a failing GitHub call with a token set leaves no trace of it in the context or the error', async () => {
    const context = contextWithRepo();
    const logs: string[] = [];
    const spy = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
    const original = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = spy;
    try {
      await createRepoInspectorAgent({
        transport: createGithubTransport({
          token: TOKEN,
          fetchImpl: ((_u: unknown, init?: RequestInit) =>
            Promise.reject(
              new Error(`boom ${JSON.stringify(init?.headers)} ${String(_u)}`),
            )) as typeof fetch,
        }),
      }).run(context, () => {}, control());
    } finally {
      [console.log, console.warn, console.error] = original;
    }
    expect(context.siteResults?.[REPO_CHECK_ID]?.status).toBe('failedToRun');
    expect(JSON.stringify(context)).not.toContain(TOKEN);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });
});

describe('roadmap and client report for a key in the repository', () => {
  const plan = planChecks(CHECKS, { website: false, supabase: false, repo: true });
  const leak: EvidenceItem = {
    id: 'ev_site_repo-secrets_1',
    check: REPO_CHECK_ID,
    findingId: null,
    table: null,
    subject: 'src/client.ts',
    kind: 'repo-file',
    verdict: 'LEAKED',
    proof: 'PROVEN',
    summary: { en: 'x', ur: 'x' },
  };
  const checks = checksFor(CHECKS, { website: false, supabase: false, repo: true });
  const results = collectResults(checks, {
    findings: [],
    cleanup: null,
    dataAccess: { status: 'notProvided' },
    provided: { website: false, supabase: false, repo: true },
    siteResults: { [REPO_CHECK_ID]: { id: REPO_CHECK_ID, status: 'completed' } },
  });
  const coverage = buildCoverage(checks, results);

  it('the check is in the coverage as checked', () => {
    expect(coverage.checked).toEqual([REPO_CHECK_ID]);
  });

  it('the roadmap says to rotate the key, critical, first', () => {
    const roadmap = buildRoadmap({
      plan,
      findings: [],
      evidence: [leak],
      coverage,
      cleanup: null,
      provided: { website: false, supabase: false, repo: true },
    });
    expect(roadmap.items[0]).toMatchObject({
      kind: 'fix-repo-secret',
      severity: 'critical',
      refs: { checkId: REPO_CHECK_ID, evidenceIds: [leak.id] },
    });
    expect(roadmap.items[0].title.en).toContain('src/client.ts');
  });

  it('the headline names the leak and the report counts it', () => {
    const gate = evaluateGate({ plan, coverage, evidence: [leak], cleanup: null });
    const report = buildClientReport({ plan, evidence: [leak], coverage, gate, roadmap: null });
    expect(report.headline.en).toMatch(/Leak found by these checks: 1 secret key in the files of the GitHub repository/);
    expect(report.findings.repo).toEqual({ leaked: 1 });
  });

  it('a report of a run without a repo has no repo field at all', () => {
    const plain = planChecks();
    const cov = buildCoverage(CHECKS, collectResults(CHECKS, {
      findings: [],
      cleanup: 'ok',
      dataAccess: { status: 'completed', zeroTables: true },
    }));
    const gate = evaluateGate({ plan: plain, coverage: cov, evidence: [], cleanup: 'ok' });
    const report = buildClientReport({ plan: plain, evidence: [], coverage: cov, gate, roadmap: null });
    expect('repo' in report.findings).toBe(false);
  });
});
