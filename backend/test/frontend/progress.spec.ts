import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// These tests check the logic of the frontend (frontend/src/lib/progress.ts).
// The frontend has no test runner of its own: adding vitest there changes its
// package-lock.json on this machine (sharp binaries for other systems drop
// out), so the tests run here. The file is loaded by path at run time, so the
// backend's TypeScript never compiles frontend code.
type Verdict = 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE';
type RetestStatus = 'not_run' | 'running' | 'passed' | 'failed';

interface Finding {
  id: string;
  verdict: Verdict;
  retest: {
    status: RetestStatus;
    lastRunAt: string | null;
    previousVerdict?: Verdict | null;
  };
  [key: string]: unknown;
}

interface Progress {
  fixed: number;
  total: number;
  notShownFixed: number;
  show: boolean;
}

interface ProgressModule {
  fixProgress(findings: readonly Finding[] | null): Progress;
  isVerifiedFixed(finding: Finding): boolean;
  isLeakNotShownFixed(finding: Finding): boolean;
  wasLeaked(finding: Finding): boolean;
}

const FRONTEND_LIB = join(process.cwd(), '..', 'frontend', 'src', 'lib');
const { fixProgress, isLeakNotShownFixed, isVerifiedFixed, wasLeaked } =
  (await import(
    /* @vite-ignore */ pathToFileURL(join(FRONTEND_LIB, 'progress.ts')).href
  )) as ProgressModule;

function finding(
  verdict: Verdict,
  status: RetestStatus,
  previousVerdict?: Verdict | null,
  id = 'fnd_001',
): Finding {
  return {
    id,
    module: 'data-access-prover',
    table: `table_${id}`,
    verdict,
    retest: {
      status,
      lastRunAt: null,
      ...(previousVerdict === undefined ? {} : { previousVerdict }),
    },
  };
}

describe('verified fixed', () => {
  it('counts LEAKED -> BLOCKED after a Re-test', () => {
    const result = fixProgress([finding('BLOCKED', 'passed', 'LEAKED')]);
    expect(result).toMatchObject({
      fixed: 1,
      total: 1,
      notShownFixed: 0,
      show: true,
    });
  });

  it('does not count LEAKED -> INCONCLUSIVE as fixed, but keeps it in the total', () => {
    const only = finding('INCONCLUSIVE', 'passed', 'LEAKED');
    expect(isVerifiedFixed(only)).toBe(false);
    expect(isLeakNotShownFixed(only)).toBe(true);
    expect(wasLeaked(only)).toBe(true);
    expect(fixProgress([only])).toMatchObject({
      fixed: 0,
      total: 1,
      notShownFixed: 1,
    });
  });

  it('keeps a fix after a later Re-test (sticky "passed", BLOCKED again)', () => {
    // the backend keeps retest.status "passed" and previousVerdict "LEAKED"
    expect(fixProgress([finding('BLOCKED', 'passed', 'LEAKED')]).fixed).toBe(1);
  });

  it('does not count a sticky "passed" that is INCONCLUSIVE now (LEAKED -> BLOCKED -> INCONCLUSIVE)', () => {
    const result = fixProgress([finding('INCONCLUSIVE', 'passed', 'LEAKED')]);
    expect(result.fixed).toBe(0);
    expect(result.notShownFixed).toBe(1);
  });

  it('lowers N when the leak comes back (LEAKED again is "failed")', () => {
    const before = fixProgress([
      finding('BLOCKED', 'passed', 'LEAKED', 'a'),
      finding('LEAKED', 'failed', 'LEAKED', 'b'),
    ]);
    expect(before).toMatchObject({ fixed: 1, total: 2 });
    const after = fixProgress([
      finding('LEAKED', 'failed', 'BLOCKED', 'a'),
      finding('LEAKED', 'failed', 'LEAKED', 'b'),
    ]);
    expect(after).toMatchObject({ fixed: 0, total: 2 });
  });

  it('ignores a table that was never LEAKED', () => {
    const list = [
      finding('BLOCKED', 'not_run', null, 'a'),
      finding('BLOCKED', 'not_run', 'BLOCKED', 'b'),
      finding('INCONCLUSIVE', 'not_run', null, 'c'),
    ];
    expect(fixProgress(list)).toMatchObject({
      fixed: 0,
      total: 0,
      show: false,
    });
  });

  it('needs "passed": a BLOCKED finding with another status is not fixed', () => {
    for (const status of ['not_run', 'running', 'failed'] as const) {
      expect(isVerifiedFixed(finding('BLOCKED', status, 'LEAKED'))).toBe(false);
    }
  });

  it('treats a missing previousVerdict as null', () => {
    expect(isVerifiedFixed(finding('BLOCKED', 'passed'))).toBe(false);
    expect(fixProgress([finding('BLOCKED', 'passed')]).show).toBe(false);
  });
});

describe('the total', () => {
  it('counts a LEAKED finding from the first audit (not fixed yet)', () => {
    expect(fixProgress([finding('LEAKED', 'failed', null)])).toMatchObject({
      fixed: 0,
      total: 1,
      show: true,
    });
  });

  it('counts a new table that is LEAKED', () => {
    const list = [
      finding('BLOCKED', 'passed', 'LEAKED', 'a'),
      finding('LEAKED', 'failed', null, 'new'),
    ];
    expect(fixProgress(list)).toMatchObject({ fixed: 1, total: 2 });
  });

  it('is 0 of 0 and hidden when no leak was ever found, and for no findings at all', () => {
    expect(fixProgress([])).toMatchObject({ fixed: 0, total: 0, show: false });
    expect(fixProgress(null)).toMatchObject({
      fixed: 0,
      total: 0,
      show: false,
    });
  });

  it('mixes the cases in one list', () => {
    const list = [
      finding('BLOCKED', 'passed', 'LEAKED', 'a'),
      finding('INCONCLUSIVE', 'passed', 'LEAKED', 'b'),
      finding('LEAKED', 'failed', 'LEAKED', 'c'),
      finding('BLOCKED', 'not_run', null, 'd'),
    ];
    expect(fixProgress(list)).toEqual({
      fixed: 1,
      total: 3,
      notShownFixed: 1,
      show: true,
    });
  });
});
