'use client';

import { fixProgress } from '@/lib/progress';
import type { Finding } from '@/lib/types';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

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
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  const progress = fixProgress(findings);
  if (!progress.show) return null;

  const text =
    uiLang === 'ur'
      ? `${progress.total} mein se ${progress.fixed} findings ki theek hone ki tasdeeq`
      : `${progress.fixed} of ${progress.total} findings verified fixed`;
  const width = `${Math.round((progress.fixed / progress.total) * 100)}%`;

  return (
    <div className="fix-progress">
      <p className="fix-progress-line">
        <strong>{text}</strong>
        <span className="muted small"> {w('by a Re-test')}</span>
      </p>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={w('Fix progress')}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.fixed}
        aria-valuetext={text}
      >
        <span className="progress-fill progress-completed" style={{ width }} />
      </div>
      {progress.notShownFixed > 0 ? (
        <p className="muted small">
          {uiLang === 'ur'
            ? `${progress.notShownFixed} tables Re-test ke baad INCONCLUSIVE hain aur theek shuda nahi ginay gaye.`
            : `${progress.notShownFixed} ${progress.notShownFixed === 1 ? 'table is' : 'tables are'} INCONCLUSIVE after the Re-test and ${progress.notShownFixed === 1 ? 'is' : 'are'} not counted as fixed.`}
        </p>
      ) : null}
      {retestActive ? (
        <p className="muted small" role="status">
          {w('Re-test running. These numbers are from the last Re-test that finished.')}
        </p>
      ) : null}
    </div>
  );
}
