import { isVerifiedFixed } from './progress';
import type { Finding, LastRetest } from './types';

// The pure rules behind the "Fix confirmed" seal, the Before -> After strip and
// the certificate unlock (R66, R67, R68). They use only what the page already
// has: the real findings and the audit. No new rule of eligibility is made here.

/** The ids of the findings a Re-test has just moved from LEAKED to BLOCKED. */
export function newlyFixedIds(
  before: readonly Finding[] | null,
  after: readonly Finding[] | null,
): string[] {
  if (!after) return [];
  const alreadyFixed = new Set(
    (before ?? []).filter(isVerifiedFixed).map((finding) => finding.id),
  );
  return after
    .filter((finding) => isVerifiedFixed(finding) && !alreadyFixed.has(finding.id))
    .map((finding) => finding.id);
}

export interface Counts {
  leaked: number;
  inconclusive: number;
  blocked: number;
}

export interface BeforeAfter {
  before: Counts;
  after: Counts;
  /** tables of the first run that the Re-test did not check: left out on both sides */
  notRechecked: number;
  /** tables the Re-test found for the first time: left out on both sides */
  newTables: number;
}

function count(list: readonly { verdict: string }[]): Counts {
  return {
    leaked: list.filter((f) => f.verdict === 'LEAKED').length,
    inconclusive: list.filter((f) => f.verdict === 'INCONCLUSIVE').length,
    blocked: list.filter((f) => f.verdict === 'BLOCKED').length,
  };
}

/**
 * Before = the verdict of the run before (`previousVerdict`, or the verdict
 * when the table has none). After = the verdict now. Only for a Re-test that
 * completed; a failed or running one shows nothing. The findings are the real
 * ones, not the copies shown as "running".
 *
 * A table that is not in the Re-test is not in the findings any more, so it is
 * not counted on either side (the page says so). A table that is new in the
 * Re-test has no "before", so it is left out on both sides.
 */
export function beforeAfter(
  findings: readonly Finding[] | null,
  lastRetest: Pick<LastRetest, 'status' | 'tablesAdded' | 'tablesRemoved'> | null,
): BeforeAfter | null {
  if (!findings || !lastRetest || lastRetest.status !== 'completed') return null;
  const added = new Set(lastRetest.tablesAdded);
  const compared = findings.filter((finding) => !added.has(finding.table));
  return {
    before: count(
      compared.map((finding) => ({
        verdict: finding.retest.previousVerdict ?? finding.verdict,
      })),
    ),
    after: count(compared),
    notRechecked: lastRetest.tablesRemoved.length,
    newTables: findings.length - compared.length,
  };
}

/** What the Re-test changed, for the strip's own sentence. Never a score. */
export function changedAnything(result: BeforeAfter): boolean {
  const keys = ['leaked', 'inconclusive', 'blocked'] as const;
  return keys.some((key) => result.before[key] !== result.after[key]);
}

export interface CertificateSubject {
  status: string | undefined;
  retestActive: boolean;
  leaked: number;
  blocked: number;
  cleanup: 'ok' | 'failed' | null | undefined;
}

export type CertificateLock = { eligible: true } | { eligible: false; reason: string };

/**
 * The same rule the Report page used before (and the backend's
 * `certificateBlocker`): completed, no Re-test running, no LEAKED, at least one
 * BLOCKED, cleanup not failed. The reason is the first rule that is not met.
 */
export function certificateLock(subject: CertificateSubject): CertificateLock {
  if (subject.status !== 'completed') {
    return { eligible: false, reason: 'The audit has not finished.' };
  }
  if (subject.retestActive) {
    return { eligible: false, reason: 'A Re-test is running. Wait until it has finished.' };
  }
  if (subject.leaked > 0) {
    return { eligible: false, reason: 'Fix the leaks and Re-test to unlock.' };
  }
  if (subject.blocked < 1) {
    return {
      eligible: false,
      reason: 'No table was shown to be BLOCKED yet, so there is no result to open.',
    };
  }
  if (subject.cleanup === 'failed') {
    return {
      eligible: false,
      reason:
        'The temporary test users could not be removed. Remove them by hand, then run a Re-test.',
    };
  }
  return { eligible: true };
}

/**
 * The unlock animation runs once, only when the user's own Re-test made the
 * audit eligible: it was locked when the Re-test started, it is eligible now
 * and the page has seen that result. A page that opens already eligible (a
 * refresh) shows the open state without any animation.
 */
export function shouldPlayUnlock(input: {
  eligibleAtStart: boolean;
  eligibleNow: boolean;
  actionObserved: boolean;
  alreadyPlayed: boolean;
}): boolean {
  return (
    input.actionObserved &&
    !input.eligibleAtStart &&
    input.eligibleNow &&
    !input.alreadyPlayed
  );
}
