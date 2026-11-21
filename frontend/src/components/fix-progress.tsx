'use client';

import { fixProgress } from '@/lib/progress';
import type { Finding } from '@/lib/types';

// "N of M findings verified fixed". Only a Re-test can move a finding from
// LEAKED to BLOCKED, and only that counts. It is a count, not a score: no
// percentage, no grade (R63).
export function FixProgress({
  findings,
  retestActive,
}: {
  /** The real findings, not the copies shown as "running" during a Re-test. */
  findings: Finding[] | null;
  retestActive: boolean;
}) {
  const progress = fixProgress(findings);
  if (!progress.show) return null;

  const text = `${progress.fixed} of ${progress.total} findings verified fixed`;
  const width = `${Math.round((progress.fixed / progress.total) * 100)}%`;

  return (
    <div className="fix-progress">
      <p className="fix-progress-line">
        <strong>{text}</strong>
        <span className="muted small"> by a Re-test</span>
      </p>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Fix progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.fixed}
        aria-valuetext={text}
      >
        <span className="progress-fill progress-completed" style={{ width }} />
      </div>
      {progress.notShownFixed > 0 ? (
        <p className="muted small">
          {progress.notShownFixed}{' '}
          {progress.notShownFixed === 1 ? 'table is' : 'tables are'}{' '}
          INCONCLUSIVE after the Re-test and{' '}
          {progress.notShownFixed === 1 ? 'is' : 'are'} not counted as fixed.
        </p>
      ) : null}
      {retestActive ? (
        <p className="muted small" role="status">
          Re-test running. These numbers are from the last Re-test that
          finished.
        </p>
      ) : null}
    </div>
  );
}
