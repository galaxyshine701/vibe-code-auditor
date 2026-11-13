'use client';

import { useState } from 'react';
import { approveFix } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { severityLabel, verdictLabel } from '@/lib/findings';
import { ApiError } from '@/lib/errors';
import type {
  Finding,
  OperationActor,
  OperationEvidence,
  RetestStatus,
} from '@/lib/types';
import { useApiError } from '@/lib/use-api-error';
import { useApp } from './app-provider';
import { CopyButton } from './copy-button';

const ACTOR_LABEL: Record<OperationActor, string> = {
  user_b: 'Second test user',
  anon: 'Visitor (no login)',
  owner: 'Owner (control)',
};

const RETEST_LABEL: Record<RetestStatus, string> = {
  not_run: 'Re-test not run',
  running: 'Re-test running',
  passed: 'Re-test passed',
  failed: 'Re-test failed',
};

function allowedLabel(allowed: boolean | null) {
  if (allowed === true) {
    return <span className="allowed allowed-yes">Allowed</span>;
  }
  if (allowed === false) {
    return <span className="allowed allowed-no">Blocked</span>;
  }
  return <span className="allowed allowed-untested">Not tested</span>;
}

function OperationRow({ item }: { item: OperationEvidence }) {
  return (
    <tr>
      <td>
        <span className="operation-name">{item.operation}</span>
      </td>
      <td>{ACTOR_LABEL[item.actor]}</td>
      <td>{allowedLabel(item.allowed)}</td>
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
  onUpdated,
  onNotFound,
}: {
  auditId: string;
  finding: Finding;
  language: 'en' | 'ur';
  actionsDisabled: boolean;
  onUpdated: (finding: Finding) => void;
  /** Called on a 404, so the page can tell whether the audit is gone (R13). */
  onNotFound?: () => void;
}) {
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
    <article className={`finding-card finding-${finding.verdict.toLowerCase()}`}>
      <div className="finding-top">
        <div className="finding-badges">
          <span className={`verdict verdict-${finding.verdict.toLowerCase()}`}>
            {verdictLabel(finding.verdict)}
          </span>
          <span className={`severity severity-${finding.severity}`}>
            {severityLabel(finding.severity)}
          </span>
          <span className="table-chip">{finding.table}</span>
          {retest.previousVerdict &&
          retest.previousVerdict !== finding.verdict ? (
            <span className="table-chip">
              was {retest.previousVerdict}, now {finding.verdict}
            </span>
          ) : null}
        </div>
        <span className={`retest-badge retest-${retest.status}`}>
          {RETEST_LABEL[retest.status]}
          {retest.lastRunAt ? ` · ${formatDate(retest.lastRunAt)}` : ''}
        </span>
      </div>

      <h3>{finding.title}</h3>
      <p className="finding-explanation">{explanation}</p>

      <dl className="metric-row">
        <div>
          <dt>Rows returned</dt>
          <dd>{finding.evidence.rowsReturned ?? '—'}</dd>
        </div>
        <div>
          <dt>HTTP status</dt>
          <dd>{finding.evidence.httpStatus ?? '—'}</dd>
        </div>
        <div>
          <dt>Module</dt>
          <dd>{finding.module}</dd>
        </div>
        {finding.evidence.canaryRowId ? (
          <div className="metric-wide">
            <dt>Canary row</dt>
            <dd className="mono-small">{finding.evidence.canaryRowId}</dd>
          </div>
        ) : null}
      </dl>

      <details
        className="disclosure"
        open={evidenceOpen}
        onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}
      >
        <summary>Evidence and operations</summary>
        <div className="disclosure-body">
          {operations.length > 0 ? (
            <div className="table-scroll">
              <table className="operations-table">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Who</th>
                    <th>Allowed</th>
                    <th>HTTP</th>
                    <th>Rows</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((item, index) => (
                    <OperationRow
                      key={`${item.operation}-${item.actor}-${index}`}
                      item={item}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No operation details for this finding.</p>
          )}

          <div className="reproducer">
            <div className="section-heading-row">
              <h4>Reproducer</h4>
              {finding.evidence.reproducer ? (
                <CopyButton text={finding.evidence.reproducer} />
              ) : null}
            </div>
            {finding.evidence.reproducer ? (
              <pre className="code-block">{finding.evidence.reproducer}</pre>
            ) : (
              <p className="muted">
                Nothing to reproduce for this finding.
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
            Suggested fix
            <span
              className={`fix-status fix-status-${finding.fix.status}`}
            >
              {finding.fix.status === 'approved' ? 'Approved' : 'Proposed'}
            </span>
          </summary>
          <div className="disclosure-body">
            <p>{finding.fix.description}</p>
            <div className="section-heading-row">
              <h4>SQL</h4>
              <CopyButton text={finding.fix.sql} label="Copy SQL" />
            </div>
            <pre className="code-block">{finding.fix.sql}</pre>

            {finding.fix.status === 'approved' ? (
              <div className="approved-note">
                <strong>Next step</strong>
                <p>
                  Run this SQL in your own Supabase project, then press Re-test.
                  The app does not run or edit the SQL for you.
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
                {approving ? 'Approving…' : 'Approve fix'}
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
