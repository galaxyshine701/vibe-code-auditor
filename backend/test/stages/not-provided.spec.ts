import { describe, expect, it } from 'vitest';
import { buildCoverage, buildEvidence } from '../../src/stages/evidence.js';
import { evaluateGate } from '../../src/stages/gate.js';
import {
  collectResults,
  type StageInput,
} from '../../src/stages/inspectors.js';
import { CHECKS } from '../../src/stages/planner-config.js';
import { planChecks, planRun } from '../../src/stages/planner.js';
import type {
  CheckResult,
  EvidenceItem,
  Provided,
  Text,
} from '../../src/stages/types.js';

const BOTH: Provided = { website: true, supabase: true };
const SUPABASE_ONLY: Provided = { website: false, supabase: true };
const WEBSITE_ONLY: Provided = { website: true, supabase: false };

const both = (t: Text) => {
  expect(t.en.length).toBeGreaterThan(0);
  expect(t.ur.length).toBeGreaterThan(0);
};

const blocked = (n = 1): EvidenceItem => ({
  id: `ev_${n}`,
  check: 'data-access-prover',
  findingId: `fnd_${n}`,
  table: `t${n}`,
  verdict: 'BLOCKED',
  proof: 'PROVEN',
  summary: { en: 's', ur: 's' },
});

const requiredOf = (provided?: Provided) =>
  Object.fromEntries(
    planChecks(CHECKS, provided).map((c) => [c.id, c.required]),
  );

describe('the planner chooses the checks from what was given', () => {
  it('without "provided" the plan is exactly what it was (flag off, old audits)', () => {
    expect(planChecks(CHECKS)).toEqual(planChecks(CHECKS, undefined));
    expect(requiredOf()).toEqual({
      'data-access-prover': true,
      'tls-headers': true,
      'bundle-secrets': true,
      'active-checks': false,
    });
    expect(requiredOf(BOTH)).toEqual(requiredOf());
  });

  it('Supabase given, no website: the Prover stays required, the website checks are optional', () => {
    expect(requiredOf(SUPABASE_ONLY)).toEqual({
      'data-access-prover': true,
      'tls-headers': false,
      'bundle-secrets': false,
      'active-checks': false,
    });
  });

  it('website given, no Supabase: the website checks are required, the Prover is optional', () => {
    expect(requiredOf(WEBSITE_ONLY)).toEqual({
      'data-access-prover': false,
      'tls-headers': true,
      'bundle-secrets': true,
      'active-checks': false,
    });
  });

  it('every check is still listed, in the same order, with the same id, title and mode', () => {
    const base = planChecks(CHECKS);
    for (const provided of [SUPABASE_ONLY, WEBSITE_ONLY, BOTH]) {
      const plan = planChecks(CHECKS, provided);
      expect(plan.map((c) => [c.id, c.title, c.mode])).toEqual(
        base.map((c) => [c.id, c.title, c.mode]),
      );
    }
  });

  it('planRun passes "provided" on and still carries the bundle limits', () => {
    const run = planRun(CHECKS, WEBSITE_ONLY);
    expect(run.plan).toEqual(planChecks(CHECKS, WEBSITE_ONLY));
    expect(run.limits.bundle.maxFiles).toBeGreaterThan(0);
  });
});

describe('a check that was not provided is skipped, with the reason in both languages', () => {
  const input = (
    provided: Provided,
    over: Partial<StageInput> = {},
  ): StageInput => ({
    findings: [],
    cleanup: null,
    dataAccess: provided.supabase
      ? { status: 'completed' }
      : { status: 'notProvided' },
    provided,
    ...over,
  });

  it('the reason names the check, and says what was not given', () => {
    const results = collectResults(CHECKS, input(SUPABASE_ONLY));
    for (const id of ['tls-headers', 'bundle-secrets']) {
      const result = results.find((r) => r.id === id)!;
      expect(result.status).toBe('skipped');
      both(result.reason!);
      expect(result.reason!.en).toMatch(/^Not provided/);
      expect(result.reason!.en).toMatch(/website/i);
      const title = CHECKS.find((c) => c.id === id)!.title;
      expect(result.reason!.en).toContain(title.en);
    }
    const web = collectResults(
      CHECKS,
      input(WEBSITE_ONLY, { siteResults: {} }),
    );
    const prover = web.find((r) => r.id === 'data-access-prover')!;
    expect(prover.status).toBe('skipped');
    expect(prover.reason!.en).toMatch(/^Not provided/);
    expect(prover.reason!.en).toMatch(/Supabase/);
  });

  it('the dataAccess state "notProvided" alone gives a skipped check too (not failedToRun)', () => {
    const results = collectResults(CHECKS, {
      findings: [],
      cleanup: null,
      dataAccess: { status: 'notProvided' },
    });
    const prover = results.find((r) => r.id === 'data-access-prover')!;
    expect(prover.status).toBe('skipped');
    expect(prover.reason!.en).toMatch(/^Not provided/);
  });

  it('it lands in coverage.skipped, never in checked and never in failedToRun', () => {
    const coverage = buildCoverage(
      CHECKS,
      collectResults(CHECKS, input(WEBSITE_ONLY)),
    );
    expect(coverage.skipped.map((s) => s.id)).toContain('data-access-prover');
    expect(coverage.checked).not.toContain('data-access-prover');
    expect(coverage.failedToRun.map((s) => s.id)).not.toContain(
      'data-access-prover',
    );
  });

  it('a check that WAS provided but reported nothing is not "not provided" (it fails closed)', () => {
    const results = collectResults(
      CHECKS,
      input(WEBSITE_ONLY, { siteResults: {} }),
    );
    const tls = results.find((r) => r.id === 'tls-headers')!;
    expect(tls.status).toBe('failedToRun');
  });

  it('flag off / old input (no "provided"): the old results, "Not implemented yet", unchanged', () => {
    const results = collectResults(CHECKS, {
      findings: [],
      cleanup: 'ok',
      dataAccess: { status: 'completed' },
    });
    expect(results.find((r) => r.id === 'tls-headers')).toEqual({
      id: 'tls-headers',
      status: 'skipped',
      reason: { en: 'Not implemented yet.', ur: 'Abhi bana nahi.' },
    });
  });
});

describe('gate: a URL-only run', () => {
  const urlPlan = planChecks(CHECKS, WEBSITE_ONLY);

  const coverageOf = (
    done: string[],
    other: Partial<Record<string, CheckResult['status']>> = {},
  ) => {
    const results: CheckResult[] = CHECKS.map((c) => {
      const status = done.includes(c.id)
        ? 'completed'
        : (other[c.id] ?? 'skipped');
      return {
        id: c.id,
        status,
        ...(status === 'completed'
          ? {}
          : { reason: { en: 'why', ur: 'kyun' } }),
      } as CheckResult;
    });
    return buildCoverage(CHECKS, results);
  };

  const gate = (done: string[], over = {}) =>
    evaluateGate({
      plan: urlPlan,
      coverage: coverageOf(done),
      evidence: [],
      cleanup: null,
      ...over,
    });

  it('is ready when every required check completed, with no table blocked (there is no table check)', () => {
    const g = gate(['tls-headers', 'bundle-secrets']);
    expect(g).toEqual({ decision: 'ready_by_these_checks', reasons: [] });
  });

  it('is NOT ready while a required check is not done', () => {
    expect(gate(['tls-headers']).decision).toBe('not_ready');
    expect(gate(['bundle-secrets']).decision).toBe('not_ready');
  });

  it('is NOT ready when nothing completed (an empty coverage is never ready)', () => {
    expect(gate([]).decision).toBe('not_ready');
    expect(
      evaluateGate({
        plan: urlPlan,
        coverage: buildCoverage([], []),
        evidence: [],
        cleanup: null,
      }).decision,
    ).toBe('not_ready');
  });

  it('is NOT ready when only an OPTIONAL check completed: one required check must be done', () => {
    const g = gate(['data-access-prover']);
    expect(g.decision).toBe('not_ready');
    expect(g.reasons.some((r) => /required check/i.test(r.en))).toBe(true);
    for (const reason of g.reasons) both(reason);
  });

  it('is NOT ready when a leak was found on the site', () => {
    const leak: EvidenceItem = {
      id: 'ev_site_1',
      check: 'bundle-secrets',
      findingId: null,
      table: null,
      subject: 'www.example-shop.com/app.js',
      kind: 'site-bundle',
      verdict: 'LEAKED',
      proof: 'PROVEN',
      summary: { en: 'x', ur: 'x' },
    };
    const g = gate(['tls-headers', 'bundle-secrets'], { evidence: [leak] });
    expect(g.decision).toBe('not_ready');
    expect(g.reasons.some((r) => /leak/i.test(r.en))).toBe(true);
  });

  it('a partial required check keeps it not_ready', () => {
    const results: CheckResult[] = [
      {
        id: 'data-access-prover',
        status: 'skipped',
        reason: { en: 'a', ur: 'b' },
      },
      { id: 'tls-headers', status: 'completed' },
      {
        id: 'bundle-secrets',
        status: 'partial',
        reason: { en: 'a', ur: 'b' },
        notRead: [{ name: 'app.js', reason: { en: 'a', ur: 'b' } }],
      },
      { id: 'active-checks', status: 'skipped', reason: { en: 'a', ur: 'b' } },
    ];
    const g = evaluateGate({
      plan: urlPlan,
      coverage: buildCoverage(CHECKS, results),
      evidence: [],
      cleanup: null,
    });
    expect(g.decision).toBe('not_ready');
  });
});

describe('gate: the names of the checks that were not provided', () => {
  const notProvided = [
    {
      id: 'tls-headers',
      title: CHECKS.find((c) => c.id === 'tls-headers')!.title,
    },
    {
      id: 'bundle-secrets',
      title: CHECKS.find((c) => c.id === 'bundle-secrets')!.title,
    },
  ];
  const plan = planChecks(CHECKS, SUPABASE_ONLY);
  const done = (ids: string[]) =>
    buildCoverage(
      CHECKS,
      CHECKS.map((c) =>
        ids.includes(c.id)
          ? { id: c.id, status: 'completed' as const }
          : {
              id: c.id,
              status: 'skipped' as const,
              reason: { en: 'a', ur: 'b' },
            },
      ),
    );

  it('a not_ready gate names each of them, in both languages', () => {
    const g = evaluateGate({
      plan,
      coverage: done(['data-access-prover']),
      evidence: [],
      cleanup: 'ok',
      notProvided,
    });
    expect(g.decision).toBe('not_ready'); // nothing was blocked
    for (const check of notProvided) {
      expect(g.reasons.some((r) => r.en.includes(check.title.en))).toBe(true);
      expect(g.reasons.some((r) => r.ur.includes(check.title.ur))).toBe(true);
    }
    for (const reason of g.reasons) both(reason);
  });

  it('a ready gate has no reasons at all (the contract says so), the names are in the coverage', () => {
    const g = evaluateGate({
      plan,
      coverage: done(['data-access-prover']),
      evidence: [blocked()],
      cleanup: 'ok',
      notProvided,
    });
    expect(g).toEqual({ decision: 'ready_by_these_checks', reasons: [] });
  });

  it('Supabase given: the Prover is still required, so "nothing blocked" is still not ready', () => {
    const g = evaluateGate({
      plan,
      coverage: done(['data-access-prover']),
      evidence: [],
      cleanup: 'ok',
      notProvided,
    });
    expect(
      g.reasons.some((r) => /No table was shown to be blocked/.test(r.en)),
    ).toBe(true);
  });

  it('without notProvided the reasons are what they always were', () => {
    const g = evaluateGate({
      plan,
      coverage: done([]),
      evidence: [],
      cleanup: 'ok',
    });
    expect(g.reasons.some((r) => /not provided/i.test(r.en))).toBe(false);
  });
});

describe('gate: never ready for an empty or unfinished coverage, whatever was provided', () => {
  const statuses: CheckResult['status'][] = [
    'completed',
    'partial',
    'skipped',
    'failedToRun',
  ];

  it('for every mix of statuses and every "provided", ready only if every required check completed', () => {
    for (const provided of [undefined, BOTH, SUPABASE_ONLY, WEBSITE_ONLY]) {
      const plan = planChecks(CHECKS, provided);
      const ids = CHECKS.map((c) => c.id);
      for (let code = 0; code < statuses.length ** ids.length; code++) {
        const picked = ids.map(
          (_id, i) =>
            statuses[Math.floor(code / statuses.length ** i) % statuses.length],
        );
        const results: CheckResult[] = ids.map((id, i) => ({
          id,
          status: picked[i],
          ...(picked[i] === 'completed'
            ? {}
            : { reason: { en: 'a', ur: 'b' } }),
        }));
        const coverage = buildCoverage(CHECKS, results);
        const g = evaluateGate({
          plan,
          coverage,
          evidence: buildEvidence([]).concat([blocked()]),
          cleanup: 'ok',
        });
        if (g.decision === 'ready_by_these_checks') {
          // every required check completed, and at least one required check exists
          const required = plan.filter((c) => c.required);
          expect(required.length).toBeGreaterThan(0);
          for (const c of required) expect(coverage.checked).toContain(c.id);
          expect(coverage.checked.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
