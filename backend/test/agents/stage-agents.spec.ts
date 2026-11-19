import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentControl, AgentState } from '../../src/agents/agent.js';
import { createEvidenceAgent } from '../../src/agents/evidence-agent.js';
import { createGuideAgent } from '../../src/agents/guide-agent.js';
import { createOwnershipAgent } from '../../src/agents/ownership-agent.js';
import { createPlannerAgent } from '../../src/agents/planner-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import type { Finding } from '../../src/prover/types.js';
import { buildCoverage, buildEvidence } from '../../src/stages/evidence.js';
import {
  EVIDENCE_UNAVAILABLE,
  GATE_UNAVAILABLE,
  failSafeLockC,
  unavailableCoverage,
} from '../../src/stages/failsafe.js';
import { evaluateGate } from '../../src/stages/gate.js';
import { collectResults } from '../../src/stages/inspectors.js';
import {
  BUNDLE_SCAN_LIMITS,
  CHECKS,
  type CheckDefinition,
} from '../../src/stages/planner-config.js';
import { planChecks } from '../../src/stages/planner.js';
import { OWNERSHIP_NOT_CHECKED } from '../../src/stages/run-stages.js';
import type { CheckResult, Text } from '../../src/stages/types.js';

const control = (over: Partial<AgentControl> = {}): AgentControl => ({
  shouldStop: () => false,
  redact: (text) => text,
  states: () => [],
  failure: () => null,
  ...over,
});

const finding = (
  id: string,
  table: string,
  verdict: Finding['verdict'],
  en = `${table} is ${verdict}.`,
): Finding =>
  ({
    id,
    table,
    verdict,
    severity: 'info',
    title: 'x',
    explanation: { en, ur: `${table}: ${verdict}.` },
  }) as unknown as Finding;

const mixed = () => [
  finding('fnd_001', 'bookings', 'LEAKED'),
  finding('fnd_002', 'profiles', 'BLOCKED'),
  finding('fnd_003', 'hotels', 'INCONCLUSIVE'),
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

const both = (text: Text) => {
  expect(text.en.length).toBeGreaterThan(0);
  expect(text.ur.length).toBeGreaterThan(0);
};

describe('Planner agent', () => {
  it('writes the plan the planner makes from the check list, and the bundle limits', async () => {
    const context: RunContext = {};
    const result = await createPlannerAgent().run(context, () => {}, control());
    expect(result).toBeUndefined();
    expect(context.plan).toEqual(planChecks(CHECKS));
    expect(context.limits?.bundle).toEqual(BUNDLE_SCAN_LIMITS);
  });

  it('plans EVERY check, also one without code yet (it is shown as skipped later, never left out)', async () => {
    const context: RunContext = {};
    await createPlannerAgent().run(context, () => {}, control());
    expect(context.plan?.map((c) => c.id)).toEqual(CHECKS.map((c) => c.id));
  });

  it('uses the definitions it is given (the plan comes from code, nothing else)', async () => {
    const one: CheckDefinition[] = [
      { ...CHECKS[0], id: 'only-one', limits: [] },
    ];
    const context: RunContext = {};
    await createPlannerAgent(one).run(context, () => {}, control());
    expect(context.plan?.map((c) => c.id)).toEqual(['only-one']);
  });

  it('is not critical and is a plain agent (id and name)', () => {
    const agent = createPlannerAgent();
    expect([agent.id, agent.critical]).toEqual(['planner', false]);
    expect(agent.alwaysRun).not.toBe(true);
  });
});

describe('Ownership agent', () => {
  it('finishes as skipped with the reason in both languages, and writes the contract value', async () => {
    const context: RunContext = {};
    const result = await createOwnershipAgent().run(
      context,
      () => {},
      control(),
    );
    expect(result).toEqual({ skipped: OWNERSHIP_NOT_CHECKED.reason });
    both((result as { skipped: Text }).skipped);
    expect(context.ownership).toEqual(OWNERSHIP_NOT_CHECKED);
    expect(context.ownership?.status).toBe('skipped');
  });
});

describe('Evidence agent', () => {
  const ok = (findings: Finding[], cleanup: 'ok' | 'failed' = 'ok') =>
    ({ prover: { findings, cleanup } }) as RunContext;

  it('turns the findings into evidence items and a coverage, the same way the stages did', async () => {
    const findings = mixed();
    const context = ok(findings);
    await createEvidenceAgent().run(context, () => {}, control());
    expect(context.evidence).toEqual(buildEvidence(findings));
    expect(context.coverage).toEqual(
      buildCoverage(
        CHECKS,
        collectResults(CHECKS, {
          findings,
          cleanup: 'ok',
          dataAccess: { status: 'completed', zeroTables: false },
        }),
      ),
    );
  });

  it('proof: LEAKED and BLOCKED are PROVEN, INCONCLUSIVE is UNVERIFIED (decided by code)', async () => {
    const context = ok(mixed());
    await createEvidenceAgent().run(context, () => {}, control());
    expect(context.evidence?.map((e) => [e.verdict, e.proof])).toEqual([
      ['LEAKED', 'PROVEN'],
      ['BLOCKED', 'PROVEN'],
      ['INCONCLUSIVE', 'UNVERIFIED'],
    ]);
  });

  it('no findings and a finished Prover is "zero tables": a note in the coverage', async () => {
    const context = ok([]);
    await createEvidenceAgent().run(context, () => {}, control());
    expect(context.coverage?.nothingToTest.map((n) => n.id)).toEqual([
      'data-access-prover',
    ]);
  });

  it('takes the run secrets out of every text it copies, and leaves the findings alone', async () => {
    const findings = [
      finding(
        'fnd_001',
        'bookings',
        'LEAKED',
        'it leaked, key SECRET-KEY-123 here',
      ),
    ];
    const context = ok(findings);
    await createEvidenceAgent().run(
      context,
      () => {},
      control({ redact: (t) => t.replaceAll('SECRET-KEY-123', '[REDACTED]') }),
    );
    expect(JSON.stringify(context.evidence)).not.toContain('SECRET-KEY-123');
    expect(context.evidence?.[0].summary.en).toContain('[REDACTED]');
    expect(findings[0].explanation.en).toContain('SECRET-KEY-123'); // untouched
  });

  it('only READS the findings: frozen findings and a frozen Prover result do not stop it', async () => {
    const context = ok(deepFreeze(mixed()));
    deepFreeze(context.prover);
    await expect(
      createEvidenceAgent().run(context, () => {}, control()),
    ).resolves.toBeUndefined();
    expect(context.prover?.findings).toHaveLength(3);
  });

  it('looks at the findings the service gives it (a re-test: after the merge)', async () => {
    const context = ok([finding('fnd_009', 'new_table', 'BLOCKED')]);
    context.stageFindings = () => [
      finding('fnd_001', 'bookings', 'BLOCKED'),
      finding('fnd_002', 'profiles', 'BLOCKED'),
    ];
    await createEvidenceAgent().run(context, () => {}, control());
    expect(context.evidence?.map((e) => e.findingId)).toEqual([
      'fnd_001',
      'fnd_002',
    ]);
  });

  it('a Prover that failed: no evidence, and the data access check is failedToRun with the message the service gives', async () => {
    const context: RunContext = {
      describeFailure: () => ({
        message: 'the project said no',
        cleanup: 'failed',
      }),
    };
    await createEvidenceAgent().run(
      context,
      () => {},
      control({ failure: () => new Error('raw error') }),
    );
    expect(context.evidence).toEqual([]);
    expect(context.coverage?.failedToRun).toEqual([
      {
        id: 'data-access-prover',
        reason: { en: 'the project said no', ur: expect.any(String) },
      },
    ]);
    expect(context.stageInput?.cleanup).toBe('failed');
  });

  it('a failure the service cannot describe still gives a failedToRun, never a pass', async () => {
    const context: RunContext = {};
    await createEvidenceAgent().run(context, () => {}, control());
    expect(context.coverage?.checked).not.toContain('data-access-prover');
    expect(context.coverage?.failedToRun.map((c) => c.id)).toContain(
      'data-access-prover',
    );
  });
});

describe('Guide agent', () => {
  const READY_PLAN = CHECKS.map((c) => ({
    ...c,
    required: true,
    mode: 'passive' as const,
  }));

  /** A coverage in which exactly the given statuses happened. */
  const coverageOf = (statuses: CheckResult['status'][]) => {
    const defs: CheckDefinition[] = statuses.map((_s, i) => ({
      id: `c${i}`,
      title: { en: `check ${i}`, ur: `check ${i}` },
      mode: 'passive',
      required: true,
      limits: [],
    }));
    const results: CheckResult[] = statuses.map((status, i) => ({
      id: `c${i}`,
      status,
      ...(status === 'completed' ? {} : { reason: { en: 'why', ur: 'kyun' } }),
    }));
    return { defs, coverage: buildCoverage(defs, results) };
  };

  async function guide(
    over: Partial<RunContext>,
    states: AgentState[] = [],
  ): Promise<RunContext> {
    const context: RunContext = { ...over };
    await createGuideAgent().run(
      context,
      () => {},
      control({ states: () => states }),
    );
    return context;
  }

  it('puts the stage result together: schemaVersion 2, ownership, plan, evidence, coverage and the gate', async () => {
    const evidence = await prepared(mixed());
    const context = await guide(evidence);
    expect(context.lockC).toMatchObject({
      schemaVersion: 2,
      ownership: OWNERSHIP_NOT_CHECKED,
      plan: planChecks(CHECKS),
      evidence: evidence.evidence,
      coverage: evidence.coverage,
    });
    expect(context.lockC?.gate).toEqual(
      evaluateGate({
        plan: planChecks(CHECKS),
        coverage: evidence.coverage!,
        evidence: evidence.evidence!,
        cleanup: 'ok',
      }),
    );
  });

  async function prepared(
    findings: Finding[],
    cleanup: 'ok' | 'failed' = 'ok',
  ) {
    const context: RunContext = { prover: { findings, cleanup } };
    await createEvidenceAgent().run(context, () => {}, control());
    return context;
  }

  it('never ready for ANY mix of statuses unless every required check completed (and a table was blocked)', async () => {
    const all: CheckResult['status'][] = [
      'completed',
      'partial',
      'skipped',
      'failedToRun',
    ];
    for (const a of all) {
      for (const b of all) {
        for (const c of all) {
          const { defs, coverage } = coverageOf([a, b, c]);
          const plan = planChecks(defs);
          const context = await guide({
            plan,
            evidence: buildEvidence([finding('fnd_001', 't', 'BLOCKED')]),
            coverage,
            prover: { findings: [], cleanup: 'ok' },
          });
          const ready =
            context.lockC?.gate.decision === 'ready_by_these_checks';
          expect(ready).toBe([a, b, c].every((s) => s === 'completed'));
        }
      }
    }
  });

  it('an empty coverage is never ready, not even with BLOCKED evidence', async () => {
    const context = await guide({
      plan: READY_PLAN,
      evidence: buildEvidence([finding('fnd_001', 't', 'BLOCKED')]),
      coverage: buildCoverage([], []),
      prover: { findings: [], cleanup: 'ok' },
    });
    expect(context.lockC?.gate.decision).toBe('not_ready');
  });

  it('a leak, or a failed cleanup, keeps it not_ready', async () => {
    const leak = await guide(await prepared(mixed()));
    expect(leak.lockC?.gate.decision).toBe('not_ready');
    const dirty = await guide(
      await prepared([finding('fnd_001', 't', 'BLOCKED')], 'failed'),
    );
    expect(
      dirty.lockC?.gate.reasons.some((r) => /could not be removed/.test(r.en)),
    ).toBe(true);
  });

  it('the gate does not look at the agent rows: Ownership skipped, or every row failed, changes nothing', async () => {
    const base = await prepared(mixed());
    const calm = await guide({ ...base }, []);
    const states: AgentState[] = [
      {
        id: 'ownership',
        name: 'o',
        status: 'skipped',
        progress: 0,
        reason: OWNERSHIP_NOT_CHECKED.reason!,
      },
      { id: 'planner', name: 'p', status: 'failed', progress: 0, message: 'x' },
      {
        id: 'data-access-prover',
        name: 'd',
        status: 'failed',
        progress: 0,
        code: 'TIMEOUT',
      },
      { id: 'guide', name: 'g', status: 'running', progress: 0 }, // its own row
    ];
    const noisy = await guide({ ...base }, states);
    expect(noisy.lockC?.gate).toEqual(calm.lockC?.gate);
    const proven = await guide({ ...base, ownership: { status: 'proven' } });
    expect(proven.lockC?.gate).toEqual(calm.lockC?.gate);
  });

  it('without evidence it is not_ready, with a fixed reason, no evidence and every check failedToRun', async () => {
    const context = await guide({
      prover: { findings: mixed(), cleanup: 'ok' },
    });
    const lock = context.lockC!;
    expect(lock.gate.decision).toBe('not_ready');
    expect(lock.gate.reasons[0]).toEqual(EVIDENCE_UNAVAILABLE);
    expect(lock.evidence).toEqual([]);
    expect(lock.coverage.checked).toEqual([]);
    expect(lock.coverage.failedToRun.map((c) => c.id)).toEqual(
      CHECKS.map((c) => c.id),
    );
  });

  it('evidence without a coverage is treated as no evidence', async () => {
    const context = await guide({ evidence: buildEvidence(mixed()) });
    expect(context.lockC?.gate.decision).toBe('not_ready');
    expect(context.lockC?.gate.reasons[0]).toEqual(EVIDENCE_UNAVAILABLE);
  });

  it('even a BLOCKED-only run is not ready without its coverage', async () => {
    const context = await guide({
      prover: { findings: [finding('fnd_001', 't', 'BLOCKED')], cleanup: 'ok' },
      evidence: buildEvidence([finding('fnd_001', 't', 'BLOCKED')]),
    });
    expect(context.lockC?.gate.decision).toBe('not_ready');
  });

  it('plans from code if the Planner did not leave a plan', async () => {
    const context = await guide(await prepared(mixed()));
    expect(context.lockC?.plan).toEqual(planChecks(CHECKS));
  });

  it('is a finalizer: it runs even after a failure', () => {
    const agent = createGuideAgent();
    expect([agent.id, agent.alwaysRun, agent.critical]).toEqual([
      'guide',
      true,
      false,
    ]);
    expect(createEvidenceAgent().alwaysRun).toBe(true);
  });
});

describe('the fixed "not available" results', () => {
  it('every text has both languages and never claims safety', () => {
    both(EVIDENCE_UNAVAILABLE);
    both(GATE_UNAVAILABLE);
    for (const t of [EVIDENCE_UNAVAILABLE, GATE_UNAVAILABLE]) {
      expect(`${t.en} ${t.ur}`).not.toMatch(/\bsecure\b|\bsafe\b|certif/i);
    }
  });

  it('the fail-safe stage result is not_ready, has no evidence, and lists every check as failedToRun', () => {
    const lock = failSafeLockC();
    expect(lock.schemaVersion).toBe(2);
    expect(lock.gate.decision).toBe('not_ready');
    expect(lock.gate.reasons[0]).toEqual(GATE_UNAVAILABLE);
    expect(lock.evidence).toEqual([]);
    expect(lock.coverage.checked).toEqual([]);
    expect(lock.coverage.failedToRun).toHaveLength(CHECKS.length);
    expect(lock.plan).toEqual(planChecks(CHECKS));
    expect(lock.ownership).toEqual(OWNERSHIP_NOT_CHECKED);
  });

  it('an unavailable coverage lists each planned check once', () => {
    const coverage = unavailableCoverage(planChecks(CHECKS));
    expect(coverage.failedToRun.map((c) => c.id)).toEqual(
      CHECKS.map((c) => c.id),
    );
    for (const c of coverage.failedToRun) both(c.reason);
  });
});

describe('the stage agents are code only', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
  const files = [
    'agents/planner-agent.ts',
    'agents/ownership-agent.ts',
    'agents/evidence-agent.ts',
    'agents/guide-agent.ts',
    'stages/stage-input.ts',
    'stages/failsafe.ts',
  ];

  for (const file of files) {
    it(`${file} has no AI client, no network and no randomness`, () => {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source).not.toMatch(/report\/|groq|llm|openai|anthropic/i);
      expect(source).not.toMatch(
        /\bfetch\s*\(|node:https?|safe-fetch|XMLHttpRequest/,
      );
      expect(source).not.toMatch(/Math\.random|process\.env/);
    });
  }
});
