'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AccessGate } from '@/components/access-gate';
import { useApp } from '@/components/app-provider';
import { CleanupWarning } from '@/components/cleanup-warning';
import { ErrorBanner } from '@/components/error-banner';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { getAudit } from '@/lib/api';
import { formatDate, progressWidth } from '@/lib/format';
import {
  ApiError,
  RequestCancelledError,
} from '@/lib/errors';
import type { AuditStatus, AuditStatusResponse } from '@/lib/types';
import { useApiError } from '@/lib/use-api-error';

const STATUS_LABEL: Record<AuditStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

export default function ProgressPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { accessCode, rateLimitSecondsLeft } = useApp();
  const handleApiError = useApiError();

  const [audit, setAudit] = useState<AuditStatusResponse | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!accessCode) return;

    let cancelled = false;
    const controller = new AbortController();
    setWaiting(true);
    setError('');
    setGone(false);

    const poll = async () => {
      try {
        const result = await getAudit(id, accessCode, controller.signal);
        if (cancelled) return;
        setAudit(result);
        setWaiting(false);
        setError('');
        if (result.status === 'queued' || result.status === 'running') {
          timer.current = window.setTimeout(poll, 2_000);
        }
      } catch (caught) {
        if (cancelled || caught instanceof RequestCancelledError) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setGone(true);
          setWaiting(false);
          setError(caught.message);
          return;
        }
        setWaiting(false);
        setError(handleApiError(caught));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, [accessCode, handleApiError, id, retryTick]);

  if (!accessCode) {
    return (
      <AccessGate
        title="Access code required"
        description="Enter the access code to see this audit. It stays in this page’s memory only."
      />
    );
  }

  if (gone) {
    return (
      <div className="shell narrow-stack">
        <div className="card empty-card">
          <h1>This audit no longer exists.</h1>
          <p className="muted">
            No audit with this id was found. Audits are kept in server memory,
            so a server restart removes them.
          </p>
          <Link href="/" className="button button-primary">
            Start a new audit
          </Link>
        </div>
      </div>
    );
  }

  const status = audit?.status;
  const isRunning = status === 'queued' || status === 'running';
  const isFailed = status === 'failed';

  return (
    <div className="shell page-stack">
      <div className="page-heading">
        <div>
          <h1>{audit?.target.label ?? 'Loading audit…'}</h1>
          {audit ? (
            <p className="muted break">{audit.target.projectUrl}</p>
          ) : (
            <p className="muted">Contacting the server…</p>
          )}
        </div>
      </div>

      {error ? (
        <ErrorBanner
          message={error}
          onRetry={
            rateLimitSecondsLeft === 0
              ? () => setRetryTick((tick) => tick + 1)
              : undefined
          }
        />
      ) : null}

      <RateLimitNotice />

      {!error && waiting && !audit ? (
        <div className="card loading-card" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>Waiting for the first status answer.</strong>
            <p className="muted">
              The page polls every 2 seconds while the audit is queued or
              running.
            </p>
          </div>
        </div>
      ) : null}

      {audit ? (
        <>
          <section className="card progress-card">
            <div className="progress-top">
              <div>
                <div className="status-line">
                  <span className={`status-dot status-${audit.status}`} />
                  <strong>{STATUS_LABEL[audit.status]}</strong>
                  <span className="muted small">
                    Created {formatDate(audit.createdAt)}
                  </span>
                </div>
              </div>
              {isRunning ? (
                <span className="live-chip" role="status">
                  <span className="live-dot" aria-hidden="true" />
                  Polling every 2s
                </span>
              ) : null}
            </div>

            <div className="module-list">
              {audit.modules.map((module) => (
                <div className="module-row" key={module.id}>
                  <div className="module-name-row">
                    <div>
                      <strong>{module.name}</strong>
                      <span className={`module-status module-${module.status}`}>
                        {STATUS_LABEL[module.status]}
                      </span>
                    </div>
                    <span className="mono-small">{module.progress}%</span>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label={`${module.name} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={module.progress}
                  >
                    <span
                      className={`progress-fill progress-${module.status}`}
                      style={{ width: progressWidth(module.progress) }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {status === 'completed' ? (
              <div className="summary-grid">
                <div className="summary-item summary-leaked">
                  <span>{audit.summary.leaked}</span>
                  <strong>Leaked</strong>
                </div>
                <div className="summary-item summary-inconclusive">
                  <span>{audit.summary.inconclusive}</span>
                  <strong>Inconclusive</strong>
                </div>
                <div className="summary-item summary-blocked">
                  <span>{audit.summary.blocked}</span>
                  <strong>Blocked</strong>
                </div>
              </div>
            ) : null}

            {status === 'completed' ? (
              <div className="action-row">
                <Link
                  href={`/audits/${audit.id}/report`}
                  className="button button-primary button-large"
                >
                  View report
                </Link>
                <p className="muted small">
                  Findings are read only after the audit is completed.
                </p>
              </div>
            ) : null}

            {isFailed ? (
              <div className="failed-panel" role="alert">
                <span className="failed-symbol" aria-hidden="true">
                  !
                </span>
                <div>
                  <strong>The audit could not finish.</strong>
                  <p>
                    {audit.error?.message ??
                      'The audit stopped before it could report findings.'}
                  </p>
                  <Link href="/" className="button button-small">
                    Start a new audit
                  </Link>
                </div>
              </div>
            ) : null}
          </section>

          {audit.cleanup === 'failed' ? (
            <CleanupWarning note={audit.cleanupNote} />
          ) : null}

          {isRunning ? (
            <p className="muted center small">
              You can leave this page. The report is available after the audit
              completes.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
