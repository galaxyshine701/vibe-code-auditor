'use client';

import { useCallback, useState } from 'react';
import { approveFix } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { verdictLabel } from '@/lib/findings';
import { severityText } from '@/lib/stage-copy';
import { ApiError } from '@/lib/errors';
import type {
  Finding,
  OperationActor,
  OperationEvidence,
  RetestStatus,
  Verdict,
} from '@/lib/types';
import { useApiError } from '@/lib/use-api-error';
import { ActorDiagram } from './actor-diagram';
import { useApp } from './app-provider';
import { CopyButton } from './copy-button';
import { FixSeal } from './fix-seal';
import { VerdictBadge } from './verdict';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

const ACTOR_LABEL: Record<OperationActor, string> = {
  user_b: 'User B',
  anon: 'Anon',
  owner: 'Owner A',
};

const RETEST_LABEL: Record<RetestStatus, string> = {
  not_run: 'Re-test not run',
  running: 'Re-test running',
  passed: 'Re-test passed',
  failed: 'Re-test failed',
};

function resultLabel(
  item: OperationEvidence,
  verdict: Verdict,
): { text: string; className: string } {
  if (item.allowed === null) {
    return { text: 'Not tested', className: 'allowed-untested' };
  }
  if (item.allowed === false) {
    return { text: 'Blocked', className: 'allowed-no' };
  }
  if (item.actor === 'owner') {
    return { text: 'Allowed', className: 'allowed-neutral' };
  }
  if (verdict === 'LEAKED') {
    return { text: 'Reached', className: 'allowed-yes' };
  }
  return { text: 'Allowed', className: 'allowed-neutral' };
}

function OperationRow({
  item,
  verdict,
}: {
  item: OperationEvidence;
  verdict: Verdict;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  const result = resultLabel(item, verdict);

  return (
    <tr>
      <td>
        <span className="operation-name">{item.operation}</span>
      </td>
      <td>{ACTOR_LABEL[item.actor]}</td>
      <td>
        <span className={`allowed ${result.className}`}>{w(result.text)}</span>
      </td>
      <td>{item.httpStatus ?? '—'}</td>
      <td>{item.rowsReturned ?? '—'}</td>
      <td className="operation-note">{item.note ?? '—'}</td>
    </tr>
  );
}

export function FindingCard({
  auditId,
  finding,
  language,
  actionsDisabled,
  sealed = false,
  sealAnimate = false,
  onSealDone,
  onUpdated,
  onNotFound,
}: {
  auditId: string;
  finding: Finding;
  language: 'en' | 'ur';
  actionsDisabled: boolean;
  /** A Re-test moved this finding from LEAKED to BLOCKED (isVerifiedFixed). */
  sealed?: boolean;
  /** The seal animates now (once, after the user's own Re-test). */
  sealAnimate?: boolean;
  onSealDone?: (findingId: string) => void;
  onUpdated: (finding: Finding) => void;
  /** Called on a 404, so the page can tell whether the audit is gone (R13). */
  onNotFound?: () => void;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  const { accessCode, rateLimitSecondsLeft } = useApp();
  const handleApiError = useApiError();
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);

  const explanation =
    language === 'ur'
      ? finding.explanation.ur || finding.explanation.en
      : finding.explanation.en;
  const operations = finding.evidence.operations ?? [];
  const retest = finding.retest;
  const findingId = finding.id;
  const sealDone = useCallback(
    () => onSealDone?.(findingId),
    [findingId, onSealDone],
  );

  async function approve() {
    if (!finding.fix || finding.fix.status !== 'proposed') return;
    setApproving(true);
    setApproveError('');
    try {
      const updated = await approveFix(auditId, finding.id, accessCode);
      setFixOpen(true);
      onUpdated(updated);
    } catch (error) {
      setApproveError(handleApiError(error));
      if (error instanceof ApiError && error.status === 404) onNotFound?.();
    } finally {
      setApproving(false);
    }
  }

  return (
    <article
      id={`finding-${finding.id}`}
      className={`finding-card finding-${finding.verdict.toLowerCase()} glass`}
    >
      <div className="finding-top">
        <div className="finding-badges">
          <VerdictBadge
            verdict={finding.verdict}
            label={verdictLabel(finding.verdict)}
          />
          <span className={`severity severity-${finding.severity}`}>
            {severityText(finding.severity, language)}
          </span>
          <span className="table-chip">{finding.table}</span>
          {retest.previousVerdict &&
          retest.previousVerdict !== finding.verdict ? (
            <span className="table-chip">
              {uiLang === 'ur'
                ? `pehle ${retest.previousVerdict}, ab ${finding.verdict}`
                : `was ${retest.previousVerdict}, now ${finding.verdict}`}
            </span>
          ) : null}
        </div>
        <span className={`retest-badge retest-${retest.status}`}>
          {w(
            retest.status === 'not_run' && retest.lastRunAt
              ? 'Re-tested'
              : RETEST_LABEL[retest.status],
          )}
          {retest.lastRunAt ? ` · ${formatDate(retest.lastRunAt)}` : ''}
        </span>
      </div>

      {sealed ? <FixSeal animate={sealAnimate} onDone={sealDone} /> : null}

      <h3>{finding.title}</h3>
      <p className="finding-explanation">{explanation}</p>
      {finding.explanationSource === 'ai' && language !== 'ur' ? (
        <p className="muted small">{w('Written by AI')}</p>
      ) : null}

      <ActorDiagram operations={operations} verdict={finding.verdict} />

      <dl className="metric-row">
        <div>
          <dt>{w('Rows returned')}</dt>
          <dd>{finding.evidence.rowsReturned ?? '—'}</dd>
        </div>
        <div>
          <dt>{w('HTTP status')}</dt>
          <dd>{finding.evidence.httpStatus ?? '—'}</dd>
        </div>
        <div>
          <dt>{w('Module')}</dt>
          <dd>{finding.module}</dd>
        </div>
        {finding.evidence.canaryRowId ? (
          <div className="metric-wide">
            <dt>{w('Canary row')}</dt>
            <dd className="mono-small">{finding.evidence.canaryRowId}</dd>
          </div>
        ) : null}
      </dl>

      <details
        className="disclosure"
        open={evidenceOpen}
        onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}
      >
        <summary>{w('Evidence and operations')}</summary>
        <div className="disclosure-body">
          {operations.length > 0 ? (
            <div className="table-scroll">
              <table className="operations-table">
                <thead>
                  <tr>
                    <th>{w('Operation')}</th>
                    <th>{w('Who')}</th>
                    <th>{w('Result')}</th>
                    <th>HTTP</th>
                    <th>{w('Rows')}</th>
                    <th>{w('Note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((item, index) => (
                    <OperationRow
                      key={`${item.operation}-${item.actor}-${index}`}
                      item={item}
                      verdict={finding.verdict}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{w('No operation details for this finding.')}</p>
          )}

          <div className="reproducer">
            <div className="section-heading-row">
              <h4>{w('Reproducer')}</h4>
              {finding.evidence.reproducer ? (
                <CopyButton
                  text={finding.evidence.reproducer}
                  label={w('Copy')}
                  copiedLabel={w('Copied')}
                />
              ) : null}
            </div>
            {finding.evidence.reproducer ? (
              <pre className="code-block">{finding.evidence.reproducer}</pre>
            ) : (
              <p className="muted">
                {w('Nothing to reproduce for this finding.')}
              </p>
            )}
          </div>
        </div>
      </details>

      {finding.fix ? (
        <details
          className="disclosure fix-disclosure"
          open={fixOpen}
          onToggle={(event) => setFixOpen(event.currentTarget.open)}
        >
          <summary>
            {w('Suggested fix')}
            <span className={`fix-status fix-status-${finding.fix.status}`}>
              {w(finding.fix.status === 'approved' ? 'Approved' : 'Proposed')}
            </span>
          </summary>
          <div className="disclosure-body">
            <p>{finding.fix.description}</p>
            <div className="section-heading-row">
              <h4>SQL</h4>
              <CopyButton
                text={finding.fix.sql}
                label={w('Copy SQL')}
                copiedLabel={w('Copied')}
              />
            </div>
            <pre className="code-block code-sql" tabIndex={0} aria-label="SQL">
              {finding.fix.sql}
            </pre>

            {finding.fix.status === 'approved' ? (
              <div className="approved-note">
                <strong>{w('Next step')}</strong>
                <p>
                  {w('Run this SQL in your own Supabase project, then press Re-test. The app does not run or edit the SQL for you.')}
                </p>
              </div>
            ) : (
              <button
                type="button"
                className="button button-primary"
                onClick={approve}
                disabled={
                  approving || actionsDisabled || rateLimitSecondsLeft > 0
                }
              >
                {w(approving ? 'Approving…' : 'Approve fix')}
              </button>
            )}

            {approveError ? (
              <p className="inline-error" role="alert">
                {approveError}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}
