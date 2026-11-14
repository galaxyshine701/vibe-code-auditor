import type { Finding } from './types';

// "Fix progress" is worked out only from the findings of the audit, never from a
// score. A finding is "verified fixed" only when a Re-test moved it from
// LEAKED to BLOCKED. A finding that became INCONCLUSIVE is not counted as
// fixed: the Re-test could not show that the leak is gone (R63).

/** The verdict of this table in the run before; a missing field counts as null (R46). */
function previousVerdict(finding: Finding) {
  return finding.retest.previousVerdict ?? null;
}

/**
 * True when a Re-test made this finding BLOCKED after it was LEAKED.
 * "passed" alone is not enough: the backend also gives "passed" to a finding
 * that went from LEAKED to INCONCLUSIVE.
 */
export function isVerifiedFixed(finding: Finding): boolean {
  return (
    finding.verdict === 'BLOCKED' &&
    finding.retest.status === 'passed' &&
    previousVerdict(finding) === 'LEAKED'
  );
}

/** The leak was found in this table and the Re-test could not show that it is gone. */
export function isLeakNotShownFixed(finding: Finding): boolean {
  return (
    finding.verdict === 'INCONCLUSIVE' &&
    finding.retest.status === 'passed' &&
    previousVerdict(finding) === 'LEAKED'
  );
}

/** A finding that was LEAKED, whether it still is or a Re-test changed it. */
export function wasLeaked(finding: Finding): boolean {
  return (
    finding.verdict === 'LEAKED' ||
    isVerifiedFixed(finding) ||
    isLeakNotShownFixed(finding)
  );
}

export interface FixProgress {
  /** findings a Re-test moved from LEAKED to BLOCKED */
  fixed: number;
  /** findings that were LEAKED (still LEAKED, fixed, or no longer shown as a leak) */
  total: number;
  /** findings that were LEAKED and are INCONCLUSIVE now: not counted as fixed */
  notShownFixed: number;
  /** nothing to show when no leak was ever found (no "100%") */
  show: boolean;
}

export function fixProgress(findings: readonly Finding[] | null): FixProgress {
  const list = findings ?? [];
  const total = list.filter(wasLeaked).length;
  return {
    fixed: list.filter(isVerifiedFixed).length,
    total,
    notShownFixed: list.filter(isLeakNotShownFixed).length,
    show: total >= 1,
  };
}
