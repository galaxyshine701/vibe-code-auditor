'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AccessGate } from '@/components/access-gate';
import { useApp } from '@/components/app-provider';
import { BadgeNotice } from '@/components/badges';
import { CleanupWarning } from '@/components/cleanup-warning';
import { ErrorBanner } from '@/components/error-banner';
import { LangToggle } from '@/components/lang-toggle';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { useBadges } from '@/components/use-badges';
import { getAudit } from '@/lib/api';
import { formatDate, progressWidth } from '@/lib/format';
import {
  ApiError,
  RequestCancelledError,
} from '@/lib/errors';
import {
  activityOrder,
  activityText,
  hasReasons,
  rowView,
  runningNow,
  targetLines,
} from '@/lib/progress-rows';
import { headlineOf, leakCount, noTableCheck, pick } from '@/lib/stage';
import type { AuditStatus, AuditStatusResponse } from '@/lib/types';
import { useLang } from '@/lib/use-lang';
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
  const [lang, setLang] = useLang();

  const [audit, setAudit] = useState<AuditStatusResponse | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const timer = useRef<number | undefined>(undefined);
  // Badges (R64). The audit was started by the user: if this page saw it
  // queued or running, the badge it earns gets its animation (R65).
  const badges = useBadges();
  const evaluateBadges = badges.evaluate;
  const sawRunning = useRef(false);

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
          sawRunning.current = true;
          timer.current = window.setTimeout(poll, 2_000);
        } else if (result.status === 'completed') {
          evaluateBadges({
            auditCompleted: true,
            retestActive: false,
            lastRetestStatus: result.lastRetest?.status ?? null,
            findings: null,
            // tables and secret keys in the scripts of the site (R73): a site
            // with a key in a script does not earn "no leak found"
            leaked: leakCount(result.summary),
            blocked: result.summary.blocked,
            cleanup: result.cleanup,
            actionObserved: sawRunning.current,
          });
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
  }, [accessCode, evaluateBadges, handleApiError, id, retryTick]);

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
            No audit with this id was found. The server keeps the newest 50
            audits, so an older one is no longer there.
          </p>
          <Link href="/" className="button button-primary">
            Start a new audit
          </Link>
        </div>
      </div>
    );
  }

  const headline = audit ? headlineOf(audit, null) : null;
  const status = audit?.status;
  const isRunning = status === 'queued' || status === 'running';
  const isFailed = status === 'failed';

  return (
    <div className="shell page-stack">
      <div className="page-heading">
        <div>
          <h1>{audit?.target.label ?? 'Loading audit…'}</h1>
          {audit ? (
            <ul className="target-lines">
              {targetLines(audit.target).map((line) => (
                <li key={line.kind}>
                  <span className="target-kind">
                    {line.kind === 'website'
                      ? 'Website'
                      : line.kind === 'repo'
                        ? 'GitHub repo'
                        : 'Supabase'}
                  </span>
                  <span className="muted break">{line.url}</span>
                </li>
              ))}
            </ul>
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
              <div className="progress-top-side">
                {hasReasons(audit.modules) ? (
                  <LangToggle lang={lang} onChange={setLang} />
                ) : null}
                {isRunning ? (
                  <span className="live-chip" role="status">
                    <span className="live-dot" aria-hidden="true" />
                    Polling every 2s
                  </span>
                ) : null}
              </div>
            </div>

            {audit.modules.length > 0 ? (
              <div className="activity">
                <ol className="activity-strip" aria-label="Activity of the modules">
                  {activityOrder(audit.modules).map((module) => {
                    const row = rowView(module, lang);
                    return (
                      <li
                        key={module.id}
                        className={`activity-item activity-${row.tone}`}
                      >
                        <span className="activity-dot" aria-hidden="true" />
                        <span>{activityText(module, lang)}</span>
                      </li>
                    );
                  })}
                </ol>
                {runningNow(audit.modules).length > 0 ? (
                  <p className="muted small activity-now" role="status">
                    Running now: {runningNow(audit.modules).join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="module-list">
              {audit.modules.map((module, index) => {
                const row = rowView(module, lang);
                return (
                  <div
                    className={`module-row module-row-${row.tone}`}
                    key={module.id}
                    style={{ '--row-index': index } as CSSProperties}
                  >
                    <div className="module-name-row">
                      <div>
                        <strong>{module.name}</strong>
                        <span className={`module-status module-${row.tone}`}>
                          {row.statusLabel}
                        </span>
                      </div>
                      {row.showBar ? (
                        <span className="mono-small">{row.percent}%</span>
                      ) : null}
                    </div>
                    {row.showBar ? (
                      <div
                        className="progress-track"
                        role="progressbar"
                        aria-label={`${module.name} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={row.percent}
                      >
                        <span
                          className={`progress-fill progress-${row.tone}`}
                          style={{ width: progressWidth(row.percent) }}
                        />
                      </div>
                    ) : null}
                    {row.note ? (
                      <p className={`module-note module-note-${row.noteKind}`}>
                        {row.note}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {status === 'completed' && headline ? (
              <p className={`progress-headline headline-${headline.tone}`}>
                {pick(headline.text, lang)}
              </p>
            ) : null}

            {status === 'completed' && noTableCheck(audit) ? (
              <div className="summary-grid summary-grid-site">
                {audit.target.websiteUrl ? (
                  <div
                    className={`summary-item ${
                      (audit.summary.siteLeaked ?? 0) > 0
                        ? 'summary-leaked'
                        : 'summary-blocked'
                    }`}
                  >
                    <span>{audit.summary.siteLeaked ?? 0}</span>
                    <strong>Secret keys in scripts</strong>
                  </div>
                ) : null}
                {audit.target.repoUrl ? (
                  <div
                    className={`summary-item ${
                      (audit.summary.repoLeaked ?? 0) > 0
                        ? 'summary-leaked'
                        : 'summary-blocked'
                    }`}
                  >
                    <span>{audit.summary.repoLeaked ?? 0}</span>
                    <strong>Secrets in repo</strong>
                  </div>
                ) : null}
                <p className="muted small summary-site-note">
                  No Supabase details were given, so no table was checked.
                </p>
              </div>
            ) : null}

            {status === 'completed' && !noTableCheck(audit) ? (
              <div
                className={
                  audit.summary.siteLeaked === undefined &&
                  audit.summary.repoLeaked === undefined
                    ? 'summary-grid'
                    : 'summary-grid summary-grid-four'
                }
              >
                {audit.summary.repoLeaked !== undefined ? (
                  <div
                    className={`summary-item ${
                      audit.summary.repoLeaked > 0
                        ? 'summary-leaked'
                        : 'summary-blocked'
                    }`}
                  >
                    <span>{audit.summary.repoLeaked}</span>
                    <strong>Secrets in repo</strong>
                  </div>
                ) : null}
                {audit.summary.siteLeaked !== undefined ? (
                  <div
                    className={`summary-item ${
                      audit.summary.siteLeaked > 0
                        ? 'summary-leaked'
                        : 'summary-blocked'
                    }`}
                  >
                    <span>{audit.summary.siteLeaked}</span>
                    <strong>Keys in scripts</strong>
                  </div>
                ) : null}
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
              <BadgeNotice
                state={badges.state}
                justEarned={badges.justEarned}
                celebrating={badges.celebrating}
                onCelebrated={badges.finishCelebration}
                inconclusiveCount={audit.summary.inconclusive}
              />
            ) : null}

            {status === 'completed' ? (
              <div className="action-row">
                <Link
                  href={`/audits/${audit.id}/report`}
                  className="button button-primary button-large"
                >
                  View report
                </Link>
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
            <p className="muted center small" id="running-note">
              You can leave this page. Findings are read only after the audit
              is completed.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
