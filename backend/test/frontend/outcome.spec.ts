import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { certificateBlocker } from '../../src/audits/certificate.js';

// Checks the logic and the files of "Fix confirmed", "Before and after" and the
// certificate unlock (frontend/src/lib/outcome.ts, R66 to R68). The frontend has
// no test runner of its own (see progress.spec.ts), so they run here.
type Verdict = 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE';
type RetestStatus = 'not_run' | 'running' | 'passed' | 'failed';

interface Finding {
  id: string;
  table: string;
  verdict: Verdict;
  retest: {
    status: RetestStatus;
    lastRunAt: string | null;
    previousVerdict?: Verdict | null;
  };
  [key: string]: unknown;
}

interface Counts {
  leaked: number;
  inconclusive: number;
  blocked: number;
}

interface BeforeAfter {
  before: Counts;
  after: Counts;
  notRechecked: number;
  newTables: number;
}

type Lock = { eligible: true } | { eligible: false; reason: string };

interface Subject {
  status: string | undefined;
  retestActive: boolean;
  leaked: number;
  blocked: number;
  cleanup: 'ok' | 'failed' | null | undefined;
}

interface OutcomeModule {
  newlyFixedIds(
    before: readonly Finding[] | null,
    after: readonly Finding[] | null,
  ): string[];
  beforeAfter(
    findings: readonly Finding[] | null,
    lastRetest: {
      status: string;
      tablesAdded: string[];
      tablesRemoved: string[];
    } | null,
  ): BeforeAfter | null;
  changedAnything(result: BeforeAfter): boolean;
  certificateLock(subject: Subject): Lock;
  shouldPlayUnlock(input: {
    eligibleAtStart: boolean;
    eligibleNow: boolean;
    actionObserved: boolean;
    alreadyPlayed: boolean;
  }): boolean;
}

const FRONTEND = join(process.cwd(), '..', 'frontend');
const {
  newlyFixedIds,
  beforeAfter,
  changedAnything,
  certificateLock,
  shouldPlayUnlock,
} = (await import(
  /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'outcome.ts'))
    .href
)) as OutcomeModule;

function finding(
  id: string,
  verdict: Verdict,
  status: RetestStatus,
  previousVerdict?: Verdict | null,
  table = `table_${id}`,
): Finding {
  return {
    id,
    table,
    verdict,
    retest: {
      status,
      lastRunAt: null,
      ...(previousVerdict === undefined ? {} : { previousVerdict }),
    },
  };
}

const completed = { status: 'completed', tablesAdded: [], tablesRemoved: [] };

describe('newlyFixedIds: which findings get the seal animation', () => {
  it('a finding the Re-test moved from LEAKED to BLOCKED is new', () => {
    const before = [finding('a', 'LEAKED', 'not_run')];
    const after = [finding('a', 'BLOCKED', 'passed', 'LEAKED')];
    expect(newlyFixedIds(before, after)).toEqual(['a']);
  });

  it('LEAKED to INCONCLUSIVE gets no seal, even though the status is "passed"', () => {
    const before = [finding('a', 'LEAKED', 'not_run')];
    const after = [finding('a', 'INCONCLUSIVE', 'passed', 'LEAKED')];
    expect(newlyFixedIds(before, after)).toEqual([]);
  });

  it('"passed" alone is not enough: a BLOCKED table that was never LEAKED gets no seal', () => {
    const before = [finding('a', 'BLOCKED', 'not_run')];
    expect(
      newlyFixedIds(before, [finding('a', 'BLOCKED', 'passed', 'BLOCKED')]),
    ).toEqual([]);
    expect(
      newlyFixedIds(before, [finding('a', 'BLOCKED', 'passed', null)]),
    ).toEqual([]);
  });

  it('a finding that was already fixed before this Re-test does not animate again', () => {
    const fixed = finding('a', 'BLOCKED', 'passed', 'LEAKED');
    expect(newlyFixedIds([fixed], [fixed])).toEqual([]);
  });

  it('only the new one of several', () => {
    const before = [
      finding('a', 'BLOCKED', 'passed', 'LEAKED'),
      finding('b', 'LEAKED', 'not_run'),
      finding('c', 'LEAKED', 'not_run'),
    ];
    const after = [
      finding('a', 'BLOCKED', 'passed', 'LEAKED'),
      finding('b', 'BLOCKED', 'passed', 'LEAKED'),
      finding('c', 'LEAKED', 'failed', 'LEAKED'),
    ];
    expect(newlyFixedIds(before, after)).toEqual(['b']);
  });

  it('nothing for no findings', () => {
    expect(newlyFixedIds(null, null)).toEqual([]);
    expect(newlyFixedIds([], [])).toEqual([]);
  });
});

describe('beforeAfter: the strip above the report', () => {
  it('Leaked 1 to 0 and Blocked 1 to 2', () => {
    const findings = [
      finding('a', 'BLOCKED', 'passed', 'LEAKED'),
      finding('b', 'BLOCKED', 'not_run', null),
    ];
    const result = beforeAfter(findings, completed)!;
    expect(result.before).toEqual({ leaked: 1, inconclusive: 0, blocked: 1 });
    expect(result.after).toEqual({ leaked: 0, inconclusive: 0, blocked: 2 });
    expect(changedAnything(result)).toBe(true);
  });

  it('before is previousVerdict, or the verdict when there is none', () => {
    const findings = [
      finding('a', 'LEAKED', 'failed', 'LEAKED'),
      finding('b', 'INCONCLUSIVE', 'passed', 'LEAKED'),
      finding('c', 'BLOCKED', 'not_run'),
      finding('d', 'INCONCLUSIVE', 'not_run', null),
    ];
    const result = beforeAfter(findings, completed)!;
    expect(result.before).toEqual({ leaked: 2, inconclusive: 1, blocked: 1 });
    expect(result.after).toEqual({ leaked: 1, inconclusive: 2, blocked: 1 });
  });

  it.each(['failed', 'running'])('nothing for a %s Re-test', (status) => {
    const findings = [finding('a', 'BLOCKED', 'passed', 'LEAKED')];
    expect(beforeAfter(findings, { ...completed, status })).toBeNull();
  });

  it('nothing when no Re-test was run, or no findings are read', () => {
    expect(beforeAfter([finding('a', 'LEAKED', 'not_run')], null)).toBeNull();
    expect(beforeAfter(null, completed)).toBeNull();
  });

  it('no change is said as such', () => {
    const findings = [finding('a', 'LEAKED', 'failed', 'LEAKED')];
    expect(changedAnything(beforeAfter(findings, completed)!)).toBe(false);
  });

  it('a table that is not in the Re-test is counted on neither side, and is told', () => {
    // "gone" is not in the findings any more; the Re-test lists it as removed
    const findings = [finding('a', 'BLOCKED', 'passed', 'LEAKED')];
    const result = beforeAfter(findings, {
      ...completed,
      tablesRemoved: ['gone'],
    })!;
    expect(result.before).toEqual({ leaked: 1, inconclusive: 0, blocked: 0 });
    expect(result.after).toEqual({ leaked: 0, inconclusive: 0, blocked: 1 });
    expect(result.notRechecked).toBe(1);
  });

  it('a table found for the first time is counted on neither side, and is told', () => {
    const findings = [
      finding('a', 'BLOCKED', 'passed', 'LEAKED', 'old'),
      finding('b', 'LEAKED', 'not_run', null, 'fresh'),
    ];
    const result = beforeAfter(findings, {
      ...completed,
      tablesAdded: ['fresh'],
    })!;
    expect(result.before.leaked).toBe(1);
    expect(result.after.leaked).toBe(0);
    expect(result.after.blocked).toBe(1);
    expect(result.newTables).toBe(1);
  });
});

describe('certificateLock: the same rule as before, with the reason', () => {
  const base: Subject = {
    status: 'completed',
    retestActive: false,
    leaked: 0,
    blocked: 1,
    cleanup: 'ok',
  };

  it('is open when the rule holds', () => {
    expect(certificateLock(base)).toEqual({ eligible: true });
    expect(certificateLock({ ...base, cleanup: null })).toEqual({
      eligible: true,
    });
  });

  it('leaks give "Fix the leaks and Re-test to unlock."', () => {
    expect(certificateLock({ ...base, leaked: 2 })).toEqual({
      eligible: false,
      reason: 'Fix the leaks and Re-test to unlock.',
    });
  });

  it('each other reason has its own sentence', () => {
    const reasons = [
      certificateLock({ ...base, status: 'running' }),
      certificateLock({ ...base, retestActive: true }),
      certificateLock({ ...base, blocked: 0 }),
      certificateLock({ ...base, cleanup: 'failed' }),
    ].map((lock) => (lock.eligible ? '' : lock.reason));
    expect(new Set(reasons).size).toBe(4);
    for (const reason of reasons) expect(reason.length).toBeGreaterThan(10);
    expect(reasons).not.toContain('Fix the leaks and Re-test to unlock.');
  });

  it('says the leak sentence only for leaks, not for the other reasons', () => {
    for (const subject of [
      { ...base, blocked: 0 },
      { ...base, cleanup: 'failed' as const },
    ]) {
      const lock = certificateLock(subject);
      expect(lock.eligible ? '' : lock.reason).not.toContain('Fix the leaks');
    }
  });

  it('agrees with the rule the Report page had before, for every combination', () => {
    const old = (s: Subject) =>
      s.status === 'completed' &&
      !s.retestActive &&
      s.leaked === 0 &&
      s.blocked >= 1 &&
      s.cleanup !== 'failed';
    for (const status of ['completed', 'running', 'failed']) {
      for (const retestActive of [false, true]) {
        for (const leaked of [0, 1]) {
          for (const blocked of [0, 1, 3]) {
            for (const cleanup of ['ok', 'failed', null] as const) {
              const subject = {
                status,
                retestActive,
                leaked,
                blocked,
                cleanup,
              };
              expect(
                certificateLock(subject).eligible,
                JSON.stringify(subject),
              ).toBe(old(subject));
            }
          }
        }
      }
    }
  });

  it('agrees with the backend certificateBlocker', () => {
    const verdicts = (leaked: number, blocked: number) => [
      ...Array.from({ length: leaked }, (_, i) => ({
        verdict: 'LEAKED',
        id: `l${i}`,
      })),
      ...Array.from({ length: blocked }, (_, i) => ({
        verdict: 'BLOCKED',
        id: `b${i}`,
      })),
    ];
    for (const leaked of [0, 1]) {
      for (const blocked of [0, 2]) {
        for (const cleanup of ['ok', 'failed', null] as const) {
          const backend = certificateBlocker({
            status: 'completed',
            findings: verdicts(leaked, blocked),
            cleanup,
          } as never);
          expect(
            certificateLock({
              status: 'completed',
              retestActive: false,
              leaked,
              blocked,
              cleanup,
            }).eligible,
          ).toBe(backend === null);
        }
      }
    }
  });
});

describe("shouldPlayUnlock: once, and only after the user's own Re-test", () => {
  const play = {
    eligibleAtStart: false,
    eligibleNow: true,
    actionObserved: true,
    alreadyPlayed: false,
  };

  it('plays when the Re-test made the audit eligible', () => {
    expect(shouldPlayUnlock(play)).toBe(true);
  });

  it('does not play on a refresh (no action), or when it was open before', () => {
    expect(shouldPlayUnlock({ ...play, actionObserved: false })).toBe(false);
    expect(shouldPlayUnlock({ ...play, eligibleAtStart: true })).toBe(false);
  });

  it('does not play when it is still locked, or already played', () => {
    expect(shouldPlayUnlock({ ...play, eligibleNow: false })).toBe(false);
    expect(shouldPlayUnlock({ ...play, alreadyPlayed: true })).toBe(false);
  });
});

describe('the files', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(FRONTEND, 'src', ...parts), 'utf-8');
  const css = read('app', 'globals.css');
  const files = {
    seal: read('components', 'fix-seal.tsx'),
    strip: read('components', 'before-after.tsx'),
    action: read('components', 'certificate-action.tsx'),
    logic: read('lib', 'outcome.ts'),
  };

  it('every animation of the badges, the seal and the result view mark is under 800 ms', () => {
    const names = [
      'badgePop',
      'sealRing',
      'sealCore',
      'sealCanary',
      'certMarkFill',
      'certGlow',
    ];
    for (const name of names) {
      const uses = [
        ...css.matchAll(new RegExp(`animation:\\s*${name}\\s+([^;]+);`, 'g')),
      ];
      expect(uses.length, name).toBeGreaterThan(0);
      for (const use of uses) {
        const times = [...use[1].matchAll(/([\d.]+)(ms|s)\b/g)].map(
          (m) => Number(m[1]) * (m[2] === 's' ? 1000 : 1),
        );
        const total = (times[0] ?? 0) + (times[1] ?? 0); // duration + delay
        expect(total, `${name}: ${use[1]}`).toBeLessThan(800);
        expect(use[1], name).toMatch(/\b1\b/); // runs once
        expect(use[1], name).not.toContain('infinite');
      }
    }
  });

  it('with reduced motion none of them animates', () => {
    const listAt = css.indexOf('.fix-seal.is-animating .seal-ring,');
    const block = css.slice(
      css.lastIndexOf('@media (prefers-reduced-motion: reduce)', listAt),
    );
    for (const selector of [
      '.fix-seal.is-animating .seal-ring',
      '.fix-seal.is-animating .seal-core',
      '.fix-seal.is-animating .seal-canary',
      '.cert-action.is-unlocking .cert-mark-fill',
      '.cert-action.is-unlocking .cert-button',
    ]) {
      expect(block, selector).toContain(selector);
    }
    expect(block).toContain('animation: none');
    // the components do not wait for an animation that cannot run
    expect(files.seal).toContain('prefers-reduced-motion');
    expect(files.action).toContain('prefers-reduced-motion');
  });

  it('the seal starts from the verdict rule, not from "passed" alone', () => {
    const page = read('app', 'audits', '[id]', 'report', 'page.tsx');
    expect(page).toContain('isVerifiedFixed');
    expect(page).not.toMatch(/status === 'passed'/);
    expect(files.logic).toContain('isVerifiedFixed');
  });

  it('no word that claims safety or a guarantee, in the new files', () => {
    for (const [name, text] of Object.entries(files)) {
      expect(text, name).not.toMatch(
        /\b(?:secure|secured|safe|safely|certified|guarantee[ds]?)\b/i,
      );
    }
  });

  it('the new components are in files of their own and use no new library', () => {
    for (const text of [files.seal, files.strip, files.action]) {
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const source of imports) {
        expect(source).toMatch(/^(react|next\/link|@\/lib\/.+)$/);
      }
    }
  });
});
