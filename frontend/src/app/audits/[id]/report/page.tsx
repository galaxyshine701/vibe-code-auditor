'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccessGate } from '@/components/access-gate';
import { useApp } from '@/components/app-provider';
import { CleanupWarning } from '@/components/cleanup-warning';
import { Disclaimer } from '@/components/disclaimer';
import { ErrorBanner } from '@/components/error-banner';
import { FindingCard } from '@/components/finding-card';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { getAudit, getFindings, retest } from '@/lib/api';
import {
  ApiError,
  RequestCancelledError,
} from '@/lib/errors';
import { sortFindings } from '@/lib/findings';
import type { AuditStatusResponse, Finding } from '@/lib/types';
import { useApiError } from '@/lib/use-api-error';

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { accessCode, rateLimitSecondsLeft } = useApp();
  const handleApiError = useApiError();

  const [audit, setAudit] = useState<AuditStatusResponse | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ur'>('en');
  const [retestRunning, setRetestRunning] = useState(false);
  const [retestStarting, setRetestStarting] = useState(false);
  const [retestError, setRetestError] = useState('');
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!accessCode) return;

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setGone(false);

    const load = async () => {
      try {
        const status = await getAudit(id, accessCode, controller.signal);
        if (cancelled) return;
        setAudit(status);

        if (status.status === 'queued' || status.status === 'running') {
          router.replace(`/audits/${id}`);
          return;
        }

        if (status.status === 'failed') {
          setFindings(null);
          setLoading(false);
          return;
        }

        const result = await getFindings(id, accessCode, controller.signal);
        if (cancelled) return;
        setFindings(sortFindings(result.findings));
        setLoading(false);
      } catch (caught) {
        if (cancelled || caught instanceof RequestCancelledError) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setGone(true);
          setError(caught.message);
          setLoading(false);
          return;
        }
        setError(handleApiError(caught));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessCode, handleApiError, id, retryTick, router]);

  useEffect(() => {
    if (!retestRunning || !accessCode) return;

    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const status = await getAudit(id, accessCode, controller.signal);
        if (cancelled) return;
        setAudit(status);

        if (status.status === 'completed') {
          const result = await getFindings(id, accessCode, controller.signal);
          if (cancelled) return;
          setFindings(sortFindings(result.findings));
          setRetestRunning(false);
          return;
        }

        if (status.status === 'failed') {
          setRetestRunning(false);
          setRetestError(
            status.error?.message ?? 'The re-test stopped before it finished.',
          );
          return;
        }

        timer = window.setTimeout(poll, 2_000);
      } catch (caught) {
        if (cancelled || caught instanceof RequestCancelledError) return;
        setRetestRunning(false);
        setRetestError(handleApiError(caught));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [accessCode, handleApiError, id, retestRunning]);

  async function startRetest() {
    if (!accessCode) return;
    setRetestError('');
    setRetestStarting(true);
    try {
      await retest(id, accessCode);
      setFindings((current) =>
        current
          ? current.map((finding) => ({
              ...finding,
              retest: { ...finding.retest, status: 'running' },
            }))
          : current,
      );
      setRetestRunning(true);
    } catch (caught) {
      setRetestError(handleApiError(caught));
    } finally {
      setRetestStarting(false);
    }
  }

  function updateFinding(updated: Finding) {
    setFindings((current) =>
      current
        ? current.map((finding) =>
            finding.id === updated.id ? updated : finding,
          )
        : current,
    );
  }

  if (!accessCode) {
    return (
      <AccessGate
        title="Access code required"
        description="Enter the access code to read this report. It stays in this page’s memory only."
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

  if (loading) {
    return (
      <div className="shell narrow-stack">
        <div className="card loading-card" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>Reading the report…</strong>
            <p className="muted">
              Findings are read only after the audit is completed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shell narrow-stack">
        <ErrorBanner
          message={error}
          onRetry={
            rateLimitSecondsLeft === 0
              ? () => setRetryTick((tick) => tick + 1)
              : undefined
          }
        />
        <RateLimitNotice />
      </div>
    );
  }

  const failed = audit?.status === 'failed';
  const allPassed =
    findings !== null &&
    findings.length > 0 &&
    findings.every((finding) => finding.retest.status === 'passed');
  const leakedCount = audit?.summary.leaked ?? 0;

  return (
    <div className="shell page-stack">
      <div className="report-heading">
        <div>
          <h1>{audit?.target.label ?? 'Audit report'}</h1>
          {audit ? (
            <p className="muted break">{audit.target.projectUrl}</p>
          ) : null}
        </div>
      </div>

      {audit?.cleanup === 'failed' ? (
        <CleanupWarning note={audit.cleanupNote} />
      ) : null}

      {failed ? (
        <>
          <section className="card empty-card">
            <h1>The audit could not finish.</h1>
            <p className="muted">
              {audit?.error?.message ??
                'The audit stopped before it could report findings.'}
            </p>
            <Link href="/" className="button button-primary">
              Start a new audit
            </Link>
          </section>
          <Disclaimer />
        </>
      ) : (
        <>
          <section className="card report-toolbar">
            <div className="toolbar-row">
              <div className="toolbar-group">
                <span className="toolbar-label">Explanation</span>
                <div className="segmented" role="group" aria-label="Language">
                  <button
                    type="button"
                    className={language === 'en' ? 'segment active' : 'segment'}
                    aria-pressed={language === 'en'}
                    onClick={() => setLanguage('en')}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    className={language === 'ur' ? 'segment active' : 'segment'}
                    aria-pressed={language === 'ur'}
                    onClick={() => setLanguage('ur')}
                  >
                    Roman Urdu
                  </button>
                </div>
              </div>

              <div className="toolbar-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void startRetest()}
                  disabled={
                    retestRunning ||
                    retestStarting ||
                    rateLimitSecondsLeft > 0 ||
                    !findings
                  }
                >
                  {retestRunning || retestStarting
                    ? 'Re-test running…'
                    : 'Re-test'}
                </button>
                <Link
                  href={`/audits/${id}/certificate`}
                  className="button button-ghost"
                >
                  Open certificate view
                </Link>
              </div>
            </div>

            {retestRunning || retestStarting ? (
              <div className="notice notice-info" role="status">
                <span className="spinner spinner-small" aria-hidden="true" />
                Re-test is running. The page polls every 2 seconds and reads the
                findings again when it finishes.
              </div>
            ) : null}

            {retestError ? <ErrorBanner message={retestError} /> : null}
            <RateLimitNotice />
          </section>

          <section className="card summary-card">
            <div className="summary-grid summary-grid-report">
              <div className="summary-item summary-leaked">
                <span>{audit?.summary.leaked ?? 0}</span>
                <strong>Leaked</strong>
              </div>
              <div className="summary-item summary-inconclusive">
                <span>{audit?.summary.inconclusive ?? 0}</span>
                <strong>Inconclusive</strong>
              </div>
              <div className="summary-item summary-blocked">
                <span>{audit?.summary.blocked ?? 0}</span>
                <strong>Blocked</strong>
              </div>
            </div>
            {leakedCount === 0 ? (
              <p className="no-leak-line">No leak found by these checks.</p>
            ) : null}
          </section>

          {allPassed ? (
            <div className="notice notice-success" role="status">
              Re-test finished. The findings below were read again.
            </div>
          ) : null}

          <Disclaimer />

          <div className="findings-heading">
            <h2>Findings</h2>
            {findings ? (
              <span className="muted small">
                {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
              </span>
            ) : null}
          </div>

          {findings && findings.length === 0 ? (
            <div className="card empty-card">
              <h3>No findings</h3>
              <p className="muted">
                These checks returned no findings. This does not promise that
                the app is secure.
              </p>
            </div>
          ) : null}

          <div className="findings-grid">
            {findings?.map((finding) => (
              <FindingCard
                key={finding.id}
                auditId={id}
                finding={finding}
                language={language}
                actionsDisabled={retestRunning || retestStarting}
                onUpdated={updateFinding}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
