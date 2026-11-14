import type { Finding, Verdict } from '../prover/types.js';

/**
 * The retest.status rule (docs/api-contract.md, "POST /audits/:id/retest").
 * - failed: the verdict is now LEAKED
 * - passed: it was LEAKED and is not now
 * - not_run: anything else
 * mergeRetest keeps an earlier "passed" while the verdict is not LEAKED.
 */
export function retestStatusFor(
  previous: Verdict | null,
  now: Verdict,
): 'failed' | 'passed' | 'not_run' {
  if (now === 'LEAKED') return 'failed';
  if (previous === 'LEAKED') return 'passed';
  return 'not_run';
}

export function findingId(number: number): string {
  return `fnd_${String(number).padStart(3, '0')}`;
}

export interface MergeResult {
  findings: Finding[];
  tablesAdded: string[];
  tablesRemoved: string[];
  nextFindingNumber: number;
}

/**
 * Builds the new list from a finished re-test. It changes nothing it is given;
 * the caller swaps the whole list in one step.
 * - Findings are matched by table, never by position.
 * - A table in both runs keeps its id. A new table gets a new id. The id of a
 *   removed table is never reused (nextFindingNumber only grows).
 * - The fix: none for BLOCKED / INCONCLUSIVE. For a finding that is still
 *   LEAKED, the same SQL keeps its status (for example "approved"); different
 *   SQL goes back to "proposed".
 */
export function mergeRetest(
  old: Finding[],
  fresh: Finding[],
  nextFindingNumber: number,
  finishedAt: string,
): MergeResult {
  const before = new Map(old.map((f) => [f.table, f]));
  const after = new Set(fresh.map((f) => f.table));
  let next = nextFindingNumber;
  const findings = fresh.map((f): Finding => {
    const prev = before.get(f.table);
    // "passed" is kept: a later re-test must not erase the proof that a leak
    // was fixed. It holds until the verdict is LEAKED again (then "failed").
    // The previousVerdict that came with it (the LEAKED) is kept too.
    const keepsPassed =
      prev?.retest.status === 'passed' && f.verdict !== 'LEAKED';
    const previousVerdict = keepsPassed
      ? (prev.retest.previousVerdict ?? null)
      : prev
        ? prev.verdict
        : null;
    const fix =
      f.fix && prev?.fix && prev.fix.sql === f.fix.sql
        ? { ...f.fix, status: prev.fix.status }
        : f.fix;
    return {
      ...f,
      id: prev ? prev.id : findingId(next++),
      fix,
      retest: {
        status: keepsPassed
          ? 'passed'
          : retestStatusFor(prev ? prev.verdict : null, f.verdict),
        lastRunAt: finishedAt,
        previousVerdict,
      },
    };
  });
  return {
    findings,
    tablesAdded: fresh.filter((f) => !before.has(f.table)).map((f) => f.table),
    tablesRemoved: old.filter((f) => !after.has(f.table)).map((f) => f.table),
    nextFindingNumber: next,
  };
}
