import { buildFinding } from '../../src/prover/findings.js';
import type { Finding } from '../../src/prover/types.js';
import { buildCoverage, buildEvidence } from '../../src/stages/evidence.js';
import { evaluateGate } from '../../src/stages/gate.js';
import { ZERO_TABLES_NOTE } from '../../src/stages/inspectors.js';
import {
  BUNDLE_SCAN_LIMITS,
  CHECKS,
  type CheckDefinition,
} from '../../src/stages/planner-config.js';
import { planChecks } from '../../src/stages/planner.js';
import { runStages } from '../../src/stages/run-stages.js';
import type {
  CheckResult,
  Coverage,
  EvidenceItem,
  PlannedCheck,
  Text,
} from '../../src/stages/types.js';

const text = (en: string): Text => ({ en, ur: `${en} (ur)` });

const emptyCoverage = (): Coverage => ({
  checked: [],
  partial: [],
  skipped: [],
  outOfScope: [],
  failedToRun: [],
  nothingToTest: [],
  limits: [],
});

const planOf = (...required: boolean[]): PlannedCheck[] =>
  required.map((r, i) => ({
    id: `c${i}`,
    title: text(`Check ${i}`),
    mode: 'passive' as const,
    required: r,
  }));

const evidenceItem = (
  verdict: EvidenceItem['verdict'],
  n = 1,
): EvidenceItem => ({
  id: `ev_${n}`,
  check: 'data-access-prover',
  findingId: `fnd_${n}`,
  table: `t${n}`,
  verdict,
  proof: verdict === 'INCONCLUSIVE' ? 'UNVERIFIED' : 'PROVEN',
  summary: text('summary'),
});

// real findings, made by the same code the Prover uses
const finding = (
  id: string,
  verdict: 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE',
): Finding =>
  buildFinding(id, {
    table: `table_${id}`,
    ownerColumn: 'user_id',
    verdict,
    operation: 'SELECT',
    httpStatus: 200,
    rowsReturned: verdict === 'LEAKED' ? 1 : 0,
    canaryRowId: 'row-1',
    ownerValue: 'owner-1',
    culprit: 'user',
    reason: verdict === 'INCONCLUSIVE' ? 'owner-blocked' : undefined,
    operations: [],
  });

describe('gate: an empty coverage is never ready', () => {
  it('the plain case: nothing planned, nothing checked', () => {
    const gate = evaluateGate({
      plan: [],
      coverage: emptyCoverage(),
      evidence: [],
      cleanup: null,
    });
    expect(gate.decision).toBe('not_ready');
    expect(gate.decision).not.toBe('ready_by_these_checks');
    expect(gate.reasons.length).toBeGreaterThan(0);
  });

  it('never ready for ANY mix of plans, gaps, evidence and cleanup when no check completed', () => {
    const plans = [
      planOf(),
      planOf(true),
      planOf(false),
      planOf(true, false),
      planOf(false, false, false),
      planOf(true, true, true),
    ];
    const gaps = ['skipped', 'partial', 'failedToRun', 'missing'] as const;
    const evidences: EvidenceItem[][] = [
      [],
      [evidenceItem('BLOCKED')],
      [evidenceItem('BLOCKED'), evidenceItem('INCONCLUSIVE', 2)],
      [evidenceItem('INCONCLUSIVE')],
    ];
    let combinations = 0;
    for (const plan of plans) {
      // every way to give each planned check one of the four "not completed" states
      const total = gaps.length ** plan.length;
      for (let n = 0; n < total; n++) {
        const coverage = emptyCoverage();
        let rest = n;
        for (const check of plan) {
          const gap = gaps[rest % gaps.length];
          rest = Math.floor(rest / gaps.length);
          if (gap === 'skipped') {
            coverage.skipped.push({ id: check.id, reason: text('no') });
          } else if (gap === 'partial') {
            coverage.partial.push({
              id: check.id,
              reason: text('half'),
              notRead: [],
            });
          } else if (gap === 'failedToRun') {
            coverage.failedToRun.push({ id: check.id, reason: text('broke') });
          }
          // 'missing': the check is in no list at all
        }
        for (const evidence of evidences) {
          for (const cleanup of [null, 'ok', 'failed'] as const) {
            const gate = evaluateGate({ plan, coverage, evidence, cleanup });
            expect(gate.decision).toBe('not_ready');
            expect(gate.reasons.length).toBeGreaterThan(0);
            combinations += 1;
          }
        }
      }
    }
    expect(combinations).toBeGreaterThan(1000);
  });

  it('even "evidence" with BLOCKED rows cannot make an empty coverage ready', () => {
    const gate = evaluateGate({
      plan: planOf(true),
      coverage: emptyCoverage(),
      evidence: [evidenceItem('BLOCKED'), evidenceItem('BLOCKED', 2)],
      cleanup: 'ok',
    });
    expect(gate.decision).toBe('not_ready');
  });
});

describe('gate: the rules', () => {
  const ready = () => ({
    plan: planOf(true, false),
    coverage: {
      ...emptyCoverage(),
      checked: ['c0'],
      skipped: [{ id: 'c1', reason: text('later') }],
    },
    evidence: [evidenceItem('BLOCKED')],
    cleanup: 'ok' as 'ok' | 'failed' | null,
  });

  it('is ready when every required check completed, a table was blocked, no leak, cleanup ok', () => {
    const gate = evaluateGate(ready());
    expect(gate).toEqual({ decision: 'ready_by_these_checks', reasons: [] });
  });

  it('an OPTIONAL check that is skipped does not stop it', () => {
    expect(evaluateGate(ready()).decision).toBe('ready_by_these_checks');
  });

  it.each(['skipped', 'partial', 'failedToRun'] as const)(
    'a REQUIRED check that is %s keeps it not_ready, and the reason names the check',
    (state) => {
      const input = ready();
      input.plan = planOf(true, true);
      input.coverage = { ...emptyCoverage(), checked: ['c0'] };
      if (state === 'skipped')
        input.coverage.skipped.push({ id: 'c1', reason: text('r') });
      if (state === 'partial')
        input.coverage.partial.push({
          id: 'c1',
          reason: text('r'),
          notRead: [],
        });
      if (state === 'failedToRun')
        input.coverage.failedToRun.push({ id: 'c1', reason: text('r') });
      const gate = evaluateGate(input);
      expect(gate.decision).toBe('not_ready');
      expect(gate.reasons.map((r) => r.en).join(' ')).toContain('Check 1');
      expect(gate.reasons.map((r) => r.ur).join(' ')).toContain('Check 1');
    },
  );

  it('a required check that is in no list at all is not ready either', () => {
    const input = ready();
    input.plan = planOf(true, true);
    expect(evaluateGate(input).decision).toBe('not_ready');
  });

  it('a leak keeps it not_ready', () => {
    const input = ready();
    input.evidence = [evidenceItem('BLOCKED'), evidenceItem('LEAKED', 2)];
    const gate = evaluateGate(input);
    expect(gate.decision).toBe('not_ready');
    expect(gate.reasons[0].en).toContain('leak');
  });

  it('a failed cleanup keeps it not_ready', () => {
    const input = ready();
    input.cleanup = 'failed';
    expect(evaluateGate(input).decision).toBe('not_ready');
  });

  it('with nothing blocked (only inconclusive) it is not_ready', () => {
    const input = ready();
    input.evidence = [evidenceItem('INCONCLUSIVE')];
    expect(evaluateGate(input).decision).toBe('not_ready');
  });

  it('every reason has both languages and never claims safety', () => {
    const input = ready();
    input.cleanup = 'failed';
    input.evidence = [evidenceItem('LEAKED')];
    input.coverage = emptyCoverage();
    const gate = evaluateGate(input);
    for (const reason of gate.reasons) {
      expect(reason.en.length).toBeGreaterThan(0);
      expect(reason.ur.length).toBeGreaterThan(0);
      expect(reason.en.toLowerCase()).not.toMatch(
        /certif|\bsecure\b|\bsafe\b|guarantee/,
      );
    }
  });
});

describe('gate: zero tables is a state of its own', () => {
  const DATA = 'data-access-prover';
  const dataAccessPlan = (): PlannedCheck[] => [
    {
      id: DATA,
      title: text('Data access'),
      mode: 'keyed',
      required: true,
    },
  ];
  const zero = (): Parameters<typeof evaluateGate>[0] => ({
    plan: dataAccessPlan(),
    coverage: {
      ...emptyCoverage(),
      checked: [DATA],
      nothingToTest: [{ id: DATA, note: ZERO_TABLES_NOTE }],
    },
    evidence: [],
    cleanup: 'ok',
  });

  it('can be ready: the check completed, there was nothing to test, nothing is left behind', () => {
    expect(evaluateGate(zero())).toEqual({
      decision: 'ready_by_these_checks',
      reasons: [],
    });
  });

  it('is not the same as "nothing was blocked": without the zero-tables note the same input is not ready', () => {
    const input = zero();
    input.coverage = { ...emptyCoverage(), checked: [DATA] };
    const gate = evaluateGate(input);
    expect(gate.decision).toBe('not_ready');
    expect(gate.reasons.map((r) => r.en).join(' ')).toContain(
      'No table was shown to be blocked',
    );
  });

  it('is not an empty coverage: the check is in `checked`', () => {
    const input = zero();
    expect(input.coverage.checked).toEqual([DATA]);
    expect(evaluateGate(input).decision).toBe('ready_by_these_checks');
  });

  it('still needs every OTHER required check', () => {
    const input = zero();
    input.plan = [
      ...dataAccessPlan(),
      {
        id: 'tls-headers',
        title: text('Headers'),
        mode: 'passive',
        required: true,
      },
    ];
    input.coverage.skipped.push({ id: 'tls-headers', reason: text('later') });
    const gate = evaluateGate(input);
    expect(gate.decision).toBe('not_ready');
    expect(gate.reasons.map((r) => r.en).join(' ')).toContain('Headers');
  });

  it('a failed cleanup and a leak still win', () => {
    const failedCleanup = zero();
    failedCleanup.cleanup = 'failed';
    expect(evaluateGate(failedCleanup).decision).toBe('not_ready');
    const leak = zero();
    leak.evidence = [evidenceItem('LEAKED')];
    expect(evaluateGate(leak).decision).toBe('not_ready');
  });

  it('a Prover that FAILED is not zero tables, even if a note were present', () => {
    const input = zero();
    input.coverage = {
      ...emptyCoverage(),
      failedToRun: [{ id: DATA, reason: text('broke') }],
      nothingToTest: [{ id: DATA, note: ZERO_TABLES_NOTE }],
    };
    expect(evaluateGate(input).decision).toBe('not_ready');
  });

  it('a "nothing to test" note on ANOTHER check does not excuse "nothing was blocked"', () => {
    const input = zero();
    input.plan = [
      { id: 'other', title: text('Other'), mode: 'passive', required: true },
    ];
    input.coverage = {
      ...emptyCoverage(),
      checked: ['other'],
      nothingToTest: [{ id: 'other', note: text('nothing here') }],
    };
    expect(evaluateGate(input).decision).toBe('not_ready');
  });

  it('end to end: no findings and zeroTables gives a note in the coverage, in both languages', () => {
    const onlyDataAccess = CHECKS.filter((c) => c.id === DATA);
    const lock = runStages(
      {
        findings: [],
        cleanup: 'ok',
        dataAccess: { status: 'completed', zeroTables: true },
      },
      onlyDataAccess,
    );
    expect(lock.coverage.checked).toEqual([DATA]);
    expect(lock.coverage.nothingToTest).toEqual([
      { id: DATA, note: ZERO_TABLES_NOTE },
    ]);
    expect(lock.coverage.nothingToTest[0].note.en).toContain(
      'No exposed tables',
    );
    expect(lock.coverage.nothingToTest[0].note.ur.length).toBeGreaterThan(0);
    expect(lock.gate.decision).toBe('ready_by_these_checks');
  });

  it('with the real plan the gate is still not_ready today (the other required checks are skipped), but the note is there', () => {
    const lock = runStages({
      findings: [],
      cleanup: 'ok',
      dataAccess: { status: 'completed', zeroTables: true },
    });
    expect(lock.coverage.nothingToTest.map((n) => n.id)).toEqual([DATA]);
    expect(lock.gate.decision).toBe('not_ready');
    // the reasons name the skipped inspectors, not "no table blocked"
    const said = lock.gate.reasons.map((r) => r.en).join(' ');
    expect(said).not.toContain('No table was shown to be blocked');
  });

  it('a normal run (with tables) has no zero-tables note', () => {
    const lock = runStages({
      findings: [finding('fnd_001', 'BLOCKED')],
      cleanup: 'ok',
      dataAccess: { status: 'completed' },
    });
    expect(lock.coverage.nothingToTest).toEqual([]);
  });
});

describe('coverage: partial, skipped and out of scope', () => {
  const defs: CheckDefinition[] = [
    {
      id: 'a',
      title: text('A'),
      mode: 'passive',
      required: true,
      limits: [text('limit one')],
    },
    {
      id: 'b',
      title: text('B'),
      mode: 'passive',
      required: true,
      limits: [text('limit one'), text('limit two')],
    },
  ];

  it('scripts of another origin are listed BY NAME as out of scope, and the check stays completed', () => {
    const results: CheckResult[] = [
      {
        id: 'a',
        status: 'completed',
        outOfScope: [
          {
            name: 'https://cdn.other.example/lib.js',
            reason: text('other origin'),
          },
          {
            name: 'https://analytics.example/t.js',
            reason: text('other origin'),
          },
        ],
      },
      { id: 'b', status: 'completed' },
    ];
    const coverage = buildCoverage(defs, results);
    expect(coverage.checked).toEqual(['a', 'b']);
    expect(coverage.partial).toEqual([]);
    expect(coverage.outOfScope.map((o) => o.name)).toEqual([
      'https://cdn.other.example/lib.js',
      'https://analytics.example/t.js',
    ]);
    // out of scope does not hold the gate back
    expect(
      evaluateGate({
        plan: planChecks(defs),
        coverage,
        evidence: [evidenceItem('BLOCKED')],
        cleanup: 'ok',
      }).decision,
    ).toBe('ready_by_these_checks');
  });

  it('a same-origin script that was not read (cap, size, time) makes the check PARTIAL, and the gate not_ready', () => {
    const results: CheckResult[] = [
      { id: 'a', status: 'completed' },
      {
        id: 'b',
        status: 'partial',
        reason: text('2 scripts were not read'),
        notRead: [
          {
            name: 'https://site.example/big.js',
            reason: text('larger than 2 MB'),
          },
          { name: 'https://site.example/slow.js', reason: text('timeout') },
        ],
      },
    ];
    const coverage = buildCoverage(defs, results);
    expect(coverage.checked).toEqual(['a']);
    expect(coverage.partial).toHaveLength(1);
    expect(coverage.partial[0].notRead.map((n) => n.name)).toEqual([
      'https://site.example/big.js',
      'https://site.example/slow.js',
    ]);
    const gate = evaluateGate({
      plan: planChecks(defs),
      coverage,
      evidence: [evidenceItem('BLOCKED')],
      cleanup: 'ok',
    });
    expect(gate.decision).toBe('not_ready');
  });

  it('a check that reports nothing counts as skipped (a gap never looks like a pass)', () => {
    const coverage = buildCoverage(defs, [{ id: 'a', status: 'completed' }]);
    expect(coverage.skipped.map((s) => s.id)).toEqual(['b']);
  });

  it('limits are listed once each', () => {
    const coverage = buildCoverage(defs, []);
    expect(coverage.limits.map((l) => l.en)).toEqual([
      'limit one',
      'limit two',
    ]);
  });
});

describe('evidence', () => {
  it('LEAKED and BLOCKED are PROVEN, INCONCLUSIVE is UNVERIFIED', () => {
    const items = buildEvidence([
      finding('fnd_001', 'LEAKED'),
      finding('fnd_002', 'BLOCKED'),
      finding('fnd_003', 'INCONCLUSIVE'),
    ]);
    expect(items.map((i) => [i.findingId, i.verdict, i.proof])).toEqual([
      ['fnd_001', 'LEAKED', 'PROVEN'],
      ['fnd_002', 'BLOCKED', 'PROVEN'],
      ['fnd_003', 'INCONCLUSIVE', 'UNVERIFIED'],
    ]);
    expect(items[0].summary.en.length).toBeGreaterThan(0);
    expect(items[0].summary.ur.length).toBeGreaterThan(0);
  });
});

describe('the skeleton: Planner, Inspectors, Evidence, gate', () => {
  const completed = { status: 'completed' } as const;

  it('plans every check, including the ones that have no code yet', () => {
    const lock = runStages({
      findings: [],
      cleanup: 'ok',
      dataAccess: completed,
    });
    expect(lock.plan.map((p) => [p.id, p.mode, p.required])).toEqual([
      ['data-access-prover', 'keyed', true],
      ['tls-headers', 'passive', true],
      ['bundle-secrets', 'passive', true],
      ['active-checks', 'active', false],
    ]);
    expect(lock.schemaVersion).toBe(2);
  });

  it('only the data access check is completed; every other check is skipped, with a reason in both languages', () => {
    const lock = runStages({
      findings: [finding('fnd_001', 'BLOCKED')],
      cleanup: 'ok',
      dataAccess: completed,
    });
    expect(lock.coverage.checked).toEqual(['data-access-prover']);
    expect(lock.coverage.skipped.map((s) => s.id)).toEqual([
      'tls-headers',
      'bundle-secrets',
      'active-checks',
    ]);
    for (const skipped of lock.coverage.skipped) {
      expect(skipped.reason.en).toContain('Not implemented yet');
      expect(skipped.reason.ur.length).toBeGreaterThan(0);
    }
    // an active check says why it can not run: not built, and ownership
    const active = lock.coverage.skipped.find((s) => s.id === 'active-checks')!;
    expect(active.reason.en).toContain('ownership');
  });

  it('the gate is not_ready today, even with a BLOCKED finding and a clean cleanup: the required inspectors are skipped', () => {
    const lock = runStages({
      findings: [finding('fnd_001', 'BLOCKED')],
      cleanup: 'ok',
      dataAccess: completed,
    });
    expect(lock.gate.decision).toBe('not_ready');
    const said = lock.gate.reasons.map((r) => r.en).join(' ');
    expect(said).toContain('Certificate and security headers');
    expect(said).toContain('Secret keys inside the scripts');
    // the optional active check is not named as a reason
    expect(said).not.toContain('Active checks');
  });

  it('ownership is part of the answer from the start, as skipped with a reason', () => {
    const lock = runStages({
      findings: [],
      cleanup: null,
      dataAccess: completed,
    });
    expect(lock.ownership.status).toBe('skipped');
    expect(lock.ownership.reason?.en.length).toBeGreaterThan(0);
    expect(lock.ownership.reason?.ur.length).toBeGreaterThan(0);
  });

  it('a Prover that failed: failedToRun with its message, no evidence, not_ready', () => {
    const lock = runStages({
      findings: [],
      cleanup: null,
      dataAccess: {
        status: 'failedToRun',
        message: 'No exposed tables were found to test.',
      },
    });
    expect(lock.coverage.checked).toEqual([]);
    expect(lock.coverage.failedToRun).toEqual([
      {
        id: 'data-access-prover',
        reason: {
          en: 'No exposed tables were found to test.',
          ur: expect.any(String),
        },
      },
    ]);
    expect(lock.evidence).toEqual([]);
    expect(lock.gate.decision).toBe('not_ready');
  });

  it('with an EMPTY coverage the decision is never ready (the skeleton, end to end)', () => {
    // no check at all completed: the Prover failed and nothing else runs yet
    for (const cleanup of [null, 'ok', 'failed'] as const) {
      const lock = runStages({
        findings: [],
        cleanup,
        dataAccess: { status: 'failedToRun', message: 'stopped' },
      });
      expect(lock.coverage.checked).toEqual([]);
      expect(lock.gate.decision).not.toBe('ready_by_these_checks');
    }
    // and with definitions that have no check at all
    const none = runStages(
      {
        findings: [finding('fnd_001', 'BLOCKED')],
        cleanup: 'ok',
        dataAccess: completed,
      },
      [],
    );
    expect(none.coverage.checked).toEqual([]);
    expect(none.gate.decision).toBe('not_ready');
  });

  it('every planned check is in exactly one coverage list', () => {
    const lock = runStages({
      findings: [],
      cleanup: null,
      dataAccess: completed,
    });
    const listed = [
      ...lock.coverage.checked,
      ...lock.coverage.partial.map((c) => c.id),
      ...lock.coverage.skipped.map((c) => c.id),
      ...lock.coverage.failedToRun.map((c) => c.id),
    ].sort();
    expect(listed).toEqual(lock.plan.map((p) => p.id).sort());
  });

  it('the limits say that scripts of other origins are not scanned, and give the caps', () => {
    expect(BUNDLE_SCAN_LIMITS).toEqual({
      maxFiles: 30,
      maxFileBytes: 2 * 1024 * 1024,
      maxTotalBytes: 15 * 1024 * 1024,
    });
    const lock = runStages({
      findings: [],
      cleanup: null,
      dataAccess: completed,
    });
    const en = lock.coverage.limits.map((l) => l.en);
    const ur = lock.coverage.limits.map((l) => l.ur);
    expect(en).toContain('Scripts from other origins are not scanned.');
    expect(ur).toContain('Doosre origin ki scripts scan nahi hotin.');
    const caps = en.find((l) => l.includes('script files'))!;
    expect(caps).toContain('30');
    expect(caps).toContain('2 MB');
    expect(caps).toContain('15 MB');
  });

  it('never calls anything a certificate, and never claims safety', () => {
    const lock = runStages({
      findings: [finding('fnd_001', 'BLOCKED')],
      cleanup: 'ok',
      dataAccess: completed,
    });
    const all = JSON.stringify(lock).toLowerCase();
    expect(all).not.toMatch(
      /certificate of|certified|guarantee|is secure|is safe/,
    );
  });

  it('the config has unique check ids and the plan matches it', () => {
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
    expect(planChecks().map((p) => p.id)).toEqual(CHECKS.map((c) => c.id));
  });
});
