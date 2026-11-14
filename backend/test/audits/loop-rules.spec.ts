import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  certificateBlocker,
  recordHash,
  type CertificateSubject,
} from '../../src/audits/certificate.js';
import { mergeRetest, retestStatusFor } from '../../src/audits/retest-merge.js';
import type { Finding, Verdict } from '../../src/prover/types.js';

/**
 * These tests pin the two rules exactly. They are written so that changing a
 * rule by one condition (a mutation) makes at least one test fail.
 */

const stub = (
  table: string,
  verdict: Verdict,
  fix: Finding['fix'] = null,
  id = 'fnd_001',
): Finding =>
  ({
    id,
    module: 'data-access-prover',
    table,
    operation: 'SELECT',
    verdict,
    severity: verdict === 'LEAKED' ? 'critical' : 'info',
    title: `${table} ${verdict}`,
    explanation: { en: 'x', ur: 'y' },
    evidence: {
      rowsReturned: 0,
      httpStatus: 200,
      canaryRowId: null,
      reproducer: null,
      operations: [],
    },
    fix,
    retest: { status: 'not_run', lastRunAt: null },
  }) as Finding;

const fix = (sql: string, status: 'proposed' | 'approved' = 'proposed') => ({
  status,
  description: 'd',
  sql,
});

describe('retest.status rule', () => {
  // [verdict in the run before, verdict now, expected retest.status]
  const table: [Verdict | null, Verdict, string][] = [
    ['LEAKED', 'LEAKED', 'failed'],
    ['LEAKED', 'BLOCKED', 'passed'],
    ['LEAKED', 'INCONCLUSIVE', 'passed'],
    ['BLOCKED', 'LEAKED', 'failed'],
    ['BLOCKED', 'BLOCKED', 'not_run'],
    ['BLOCKED', 'INCONCLUSIVE', 'not_run'],
    ['INCONCLUSIVE', 'LEAKED', 'failed'],
    ['INCONCLUSIVE', 'BLOCKED', 'not_run'],
    ['INCONCLUSIVE', 'INCONCLUSIVE', 'not_run'],
    [null, 'LEAKED', 'failed'],
    [null, 'BLOCKED', 'not_run'],
    [null, 'INCONCLUSIVE', 'not_run'],
  ];
  it.each(table)('%s then %s gives %s', (before, now, expected) => {
    expect(retestStatusFor(before, now)).toBe(expected);
  });
});

describe('certificate rule', () => {
  const subject = (over: Partial<CertificateSubject> = {}) => {
    const base: CertificateSubject = {
      id: 'aud_1',
      label: 'L',
      projectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      createdAt: '2026-11-12T10:00:00.000Z',
      status: 'completed',
      findings: [stub('a', 'BLOCKED'), stub('b', 'INCONCLUSIVE')],
      cleanup: 'ok',
      completedAt: '2026-11-12T10:01:00.000Z',
      lastRetest: null,
    };
    return { ...base, ...over };
  };

  it('is allowed in the plain good case', () => {
    expect(certificateBlocker(subject())).toBeNull();
  });

  it('matches the rule for every combination (completed, leaks, blocked, cleanup)', () => {
    let eligible = 0;
    for (const status of ['queued', 'running', 'completed', 'failed']) {
      for (const leaked of [0, 1]) {
        for (const blocked of [0, 1, 2]) {
          for (const cleanup of ['ok', 'failed', null] as const) {
            const findings = [
              ...Array.from({ length: leaked }, (_, i) =>
                stub(`l${i}`, 'LEAKED'),
              ),
              ...Array.from({ length: blocked }, (_, i) =>
                stub(`b${i}`, 'BLOCKED'),
              ),
              stub('i', 'INCONCLUSIVE'),
            ];
            const expected =
              status === 'completed' &&
              leaked === 0 &&
              blocked >= 1 &&
              cleanup !== 'failed';
            const blocker = certificateBlocker(
              subject({ status, findings, cleanup }),
            );
            expect(
              blocker === null,
              `${status} leaked=${leaked} blocked=${blocked} cleanup=${String(cleanup)}`,
            ).toBe(expected);
            if (expected) eligible++;
          }
        }
      }
    }
    // only "completed" x no leak x (1 or 2 blocked) x (cleanup ok or null)
    expect(eligible).toBe(4);
  });

  it('refuses an audit with only INCONCLUSIVE findings', () => {
    const blocker = certificateBlocker(
      subject({ findings: [stub('h', 'INCONCLUSIVE')] }),
    );
    expect(blocker).toMatch(/blocked/i);
  });

  it('refuses an audit with no findings at all', () => {
    expect(certificateBlocker(subject({ findings: [] }))).not.toBeNull();
  });

  it('refuses when cleanup failed, even with BLOCKED findings and no leak', () => {
    expect(certificateBlocker(subject({ cleanup: 'failed' }))).toMatch(
      /removed/i,
    );
  });

  it('refuses one LEAKED finding among many BLOCKED ones', () => {
    const findings = [
      stub('a', 'BLOCKED'),
      stub('b', 'BLOCKED'),
      stub('c', 'LEAKED'),
    ];
    expect(certificateBlocker(subject({ findings }))).toMatch(/leak/i);
  });

  it('gives a different reason for each cause', () => {
    const reasons = new Set([
      certificateBlocker(subject({ status: 'running' })),
      certificateBlocker(subject({ status: 'failed' })),
      certificateBlocker(subject({ findings: [stub('x', 'LEAKED')] })),
      certificateBlocker(subject({ findings: [stub('x', 'INCONCLUSIVE')] })),
      certificateBlocker(subject({ cleanup: 'failed' })),
    ]);
    expect(reasons.size).toBe(5);
  });

  it('never uses the words "secure", "safe" or "certified" in a reason', () => {
    const all = [
      certificateBlocker(subject({ status: 'running' })),
      certificateBlocker(subject({ status: 'failed' })),
      certificateBlocker(subject({ findings: [stub('x', 'LEAKED')] })),
      certificateBlocker(subject({ findings: [] })),
      certificateBlocker(subject({ cleanup: 'failed' })),
    ].join(' ');
    expect(all).not.toMatch(/secure|safe|certified/i);
  });
});

describe('recordHash', () => {
  const base = (): CertificateSubject => ({
    id: 'aud_1',
    label: 'L',
    projectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    createdAt: '2026-11-12T10:00:00.000Z',
    status: 'completed',
    findings: [stub('a', 'BLOCKED')],
    cleanup: 'ok',
    completedAt: '2026-11-12T10:01:00.000Z',
    lastRetest: null,
  });

  it('does not depend on the order of keys', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(
      canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
    const one = base();
    const two = { ...base() };
    // same record, keys written in the reverse order
    const reversed = Object.fromEntries(
      Object.entries(two).reverse(),
    ) as unknown as CertificateSubject;
    reversed.findings = [
      Object.fromEntries(
        Object.entries(one.findings[0]).reverse(),
      ) as unknown as Finding,
    ];
    expect(recordHash(reversed)).toBe(recordHash(one));
  });

  it('is a sha256 (64 hex characters) and is the same on every call', () => {
    const s = base();
    expect(recordHash(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(recordHash(s)).toBe(recordHash(s));
  });

  it('changes when a finding, the time or the target changes', () => {
    const h = recordHash(base());
    expect(
      recordHash({ ...base(), findings: [stub('a', 'INCONCLUSIVE')] }),
    ).not.toBe(h);
    expect(recordHash({ ...base(), completedAt: 'x' })).not.toBe(h);
    expect(
      recordHash({ ...base(), projectUrl: 'https://z.supabase.co' }),
    ).not.toBe(h);
  });
});

describe('merging the findings of a re-test', () => {
  const NOW = '2026-11-12T12:20:40.000Z';

  it('keeps the id of a table that is in both runs, matching by table not position', () => {
    const old = [
      stub('bookings', 'LEAKED', fix('s1'), 'fnd_001'),
      stub('profiles', 'BLOCKED', null, 'fnd_002'),
    ];
    // the new run lists the tables in the opposite order
    const fresh = [stub('profiles', 'BLOCKED'), stub('bookings', 'BLOCKED')];
    const m = mergeRetest(old, fresh, 3, NOW);
    expect(m.findings.map((f) => [f.table, f.id])).toEqual([
      ['profiles', 'fnd_002'],
      ['bookings', 'fnd_001'],
    ]);
  });

  it('gives a new table a new id, null previousVerdict, and never reuses a dropped id', () => {
    const old = [
      stub('a', 'BLOCKED', null, 'fnd_001'),
      stub('gone', 'LEAKED', fix('s'), 'fnd_002'),
    ];
    const first = mergeRetest(
      old,
      [stub('a', 'BLOCKED'), stub('fresh', 'LEAKED', fix('t'))],
      3,
      NOW,
    );
    expect(first.tablesAdded).toEqual(['fresh']);
    expect(first.tablesRemoved).toEqual(['gone']);
    const added = first.findings.find((f) => f.table === 'fresh')!;
    expect(added.id).toBe('fnd_003');
    expect(added.retest).toEqual({
      status: 'failed', // a new table that is LEAKED
      lastRunAt: NOW,
      previousVerdict: null,
    });
    expect(first.nextFindingNumber).toBe(4);
    const second = mergeRetest(
      first.findings,
      [
        ...first.findings.map((f) => stub(f.table, 'BLOCKED')),
        stub('n', 'BLOCKED'),
      ],
      first.nextFindingNumber,
      NOW,
    );
    expect(second.findings.find((f) => f.table === 'n')!.id).toBe('fnd_004');
    expect(second.findings.map((f) => f.id)).not.toContain('fnd_002');
  });

  it('sets previousVerdict and retest.status from the run before', () => {
    const old = [stub('a', 'LEAKED', fix('s'), 'fnd_001')];
    const m = mergeRetest(old, [stub('a', 'BLOCKED')], 2, NOW);
    expect(m.findings[0].retest).toEqual({
      status: 'passed',
      lastRunAt: NOW,
      previousVerdict: 'LEAKED',
    });
    expect(m.tablesAdded).toEqual([]);
    expect(m.tablesRemoved).toEqual([]);
  });

  describe('"passed" is kept by a later re-test', () => {
    const passedBefore = (table: string): Finding => ({
      ...stub(table, 'BLOCKED', null, 'fnd_001'),
      retest: {
        status: 'passed',
        lastRunAt: '2026-11-12T11:00:00.000Z',
        previousVerdict: 'LEAKED',
      },
    });

    it('keeps "passed" and the old previousVerdict, and only moves lastRunAt', () => {
      const m = mergeRetest(
        [passedBefore('a')],
        [stub('a', 'BLOCKED')],
        2,
        NOW,
      );
      expect(m.findings[0].retest).toEqual({
        status: 'passed',
        lastRunAt: NOW,
        previousVerdict: 'LEAKED',
      });
    });

    it('keeps it through any number of re-tests', () => {
      let list = [passedBefore('a')];
      for (let i = 0; i < 3; i++) {
        list = mergeRetest(list, [stub('a', 'BLOCKED')], 2, NOW).findings;
      }
      expect(list[0].retest.status).toBe('passed');
      expect(list[0].retest.previousVerdict).toBe('LEAKED');
    });

    it('becomes "failed" when the verdict is LEAKED again, with the verdict before as previousVerdict', () => {
      const m = mergeRetest([passedBefore('a')], [stub('a', 'LEAKED')], 2, NOW);
      expect(m.findings[0].retest).toEqual({
        status: 'failed',
        lastRunAt: NOW,
        previousVerdict: 'BLOCKED',
      });
    });

    it('does not change a finding that was never "passed"', () => {
      const old = [stub('a', 'BLOCKED', null, 'fnd_001')];
      expect(
        mergeRetest(old, [stub('a', 'BLOCKED')], 2, NOW).findings[0].retest,
      ).toEqual({
        status: 'not_run',
        lastRunAt: NOW,
        previousVerdict: 'BLOCKED',
      });
    });

    it('keeps "passed" when the table is INCONCLUSIVE now (not LEAKED)', () => {
      const m = mergeRetest(
        [passedBefore('a')],
        [stub('a', 'INCONCLUSIVE')],
        2,
        NOW,
      );
      expect(m.findings[0].retest.status).toBe('passed');
      expect(m.findings[0].retest.previousVerdict).toBe('LEAKED');
    });
  });

  it('drops the fix when the finding is no longer LEAKED', () => {
    const old = [stub('a', 'LEAKED', fix('s', 'approved'), 'fnd_001')];
    expect(
      mergeRetest(old, [stub('a', 'BLOCKED')], 2, NOW).findings[0].fix,
    ).toBeNull();
    expect(
      mergeRetest(old, [stub('a', 'INCONCLUSIVE')], 2, NOW).findings[0].fix,
    ).toBeNull();
  });

  it('keeps "approved" when a still-LEAKED finding has the same SQL', () => {
    const old = [stub('a', 'LEAKED', fix('same', 'approved'), 'fnd_001')];
    const m = mergeRetest(old, [stub('a', 'LEAKED', fix('same'))], 2, NOW);
    expect(m.findings[0].fix?.status).toBe('approved');
    expect(m.findings[0].retest.status).toBe('failed');
  });

  it('goes back to "proposed" when the SQL is different', () => {
    const old = [stub('a', 'LEAKED', fix('old', 'approved'), 'fnd_001')];
    const m = mergeRetest(old, [stub('a', 'LEAKED', fix('new'))], 2, NOW);
    expect(m.findings[0].fix).toEqual(fix('new', 'proposed'));
  });

  it('does not change the lists it is given', () => {
    const old = [stub('a', 'LEAKED', fix('s', 'approved'), 'fnd_001')];
    const fresh = [stub('a', 'BLOCKED')];
    const oldCopy = structuredClone(old);
    const freshCopy = structuredClone(fresh);
    mergeRetest(old, fresh, 2, NOW);
    expect(old).toEqual(oldCopy);
    expect(fresh).toEqual(freshCopy);
  });
});
