'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessGate } from '@/components/access-gate';
import { useApp } from '@/components/app-provider';
import { BadgeStrip } from '@/components/badges';
import { BeforeAfter } from '@/components/before-after';
import { CertificateAction } from '@/components/certificate-action';
import { ClientSummary } from '@/components/client-summary';
import { CleanupWarning } from '@/components/cleanup-warning';
import { CoverageNotes } from '@/components/coverage-notes';
import { Disclaimer } from '@/components/disclaimer';
import { ErrorBanner } from '@/components/error-banner';
import { FindingCard } from '@/components/finding-card';
import { FixProgress } from '@/components/fix-progress';
import { GateBanner } from '@/components/gate-banner';
import { LangToggle } from '@/components/lang-toggle';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { RetestForm } from '@/components/retest-form';
import { ScopeBuckets } from '@/components/scope-buckets';
import { useBadges } from '@/components/use-badges';
import { getAudit, getFindings, getStageBundle, retest } from '@/lib/api';
import {
  ApiError,
  RequestCancelledError,
} from '@/lib/errors';
import { sortFindings } from '@/lib/findings';
import { unverifiedText } from '@/lib/format';
import {
  certificateLock,
  newlyFixedIds,
  shouldPlayUnlock,
} from '@/lib/outcome';
import { isVerifiedFixed } from '@/lib/progress';
import { targetLines } from '@/lib/progress-rows';
import { bucketsOf, hasStages, headlineOf, leakCount, pick } from '@/lib/stage';
import { t } from '@/lib/stage-copy';
import type { StageBundle } from '@/lib/stage-types';
import type { AuditStatusResponse, Finding } from '@/lib/types';
import { useLang } from '@/lib/use-lang';
import { useApiError } from '@/lib/use-api-error';

// Reads the three routes of the stages for a finished or failed run. A part that
// answers 404 is null (hidden, R72); any other error is told, and the rest of
// the report stays.
async function readStage(
  audit: AuditStatusResponse,
  accessCode: string,
  signal: AbortSignal,
): Promise<{ bundle: StageBundle | null; error: string }> {
  if (!hasStages(audit)) return { bundle: null, error: '' };
  try {
    return { bundle: await getStageBundle(audit, accessCode, signal), error: '' };
  } catch (caught) {
    if (caught instanceof RequestCancelledError) throw caught;
    return {
      bundle: null,
      error: caught instanceof Error ? caught.message : 'Unknown error.',
    };
  }
}

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
  const [language, setLanguage] = useLang();
  // The three routes of the stages (R72): a part that is null is hidden, never an error.
  const [stage, setStage] = useState<StageBundle | null>(null);
  const [stageError, setStageError] = useState('');
  const [retestRunning, setRetestRunning] = useState(false);
  const [retestStarting, setRetestStarting] = useState(false);
  const [retestError, setRetestError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  // The keys for a Re-test live in memory only, here in the page (R26, R29).
  const [showRetestForm, setShowRetestForm] = useState(false);
  const [retestAnonKey, setRetestAnonKey] = useState('');
  const [retestServiceKey, setRetestServiceKey] = useState('');
  const [retestConfirmed, setRetestConfirmed] = useState(false);
  const [pollError, setPollError] = useState('');
  const [pollTick, setPollTick] = useState(0);
  // Badges (R64). `retestAsked` is true after the user pressed Re-test, until
  // this page has seen the result: only then a badge gets its animation (R65).
  const badges = useBadges();
  const evaluateBadges = badges.evaluate;
  const retestAsked = useRef(false);
  // The seal and the certificate unlock (R66, R68) animate once, and only for
  // what the user's own Re-test changed in this page session.
  const findingsRef = useRef<Finding[] | null>(null);
  const [sealAnimating, setSealAnimating] = useState<string[]>([]);
  const eligibleAtStart = useRef(false);
  const unlockPlayed = useRef(false);
  const [playUnlock, setPlayUnlock] = useState(false);
  const finishSeal = useCallback((findingId: string) => {
    setSealAnimating((current) => current.filter((item) => item !== findingId));
  }, []);
  const finishUnlock = useCallback(() => setPlayUnlock(false), []);

  useEffect(() => {
    findingsRef.current = findings;
  }, [findings]);

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

        // A failed run has the stage fields too (R86).
        const stagePromise = readStage(status, accessCode, controller.signal);

        if (status.status === 'failed') {
          setFindings(null);
          const stageResult = await stagePromise;
          if (cancelled) return;
          setStage(stageResult.bundle);
          setStageError(stageResult.error);
          setLoading(false);
          return;
        }

        const result = await getFindings(id, accessCode, controller.signal);
        if (cancelled) return;
        setFindings(sortFindings(result.findings));
        const stageResult = await stagePromise;
        if (cancelled) return;
        setStage(stageResult.bundle);
        setStageError(stageResult.error);
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
    setPollError('');

    const poll = async () => {
      try {
        const status = await getAudit(id, accessCode, controller.signal);
        if (cancelled) return;
        setAudit(status);

        if (status.status === 'queued' || status.status === 'running') {
          timer = window.setTimeout(poll, 2_000);
          return;
        }

        // A failed Re-test leaves the audit "completed" and the findings as
        // they were; the failure is in lastRetest (R51).
        if (
          status.status === 'completed' &&
          status.lastRetest?.status === 'completed'
        ) {
          const result = await getFindings(id, accessCode, controller.signal);
          if (cancelled) return;
          const sorted = sortFindings(result.findings);
          // a finding that this Re-test moved from LEAKED to BLOCKED gets the seal animation
          if (retestAsked.current) {
            const fresh = newlyFixedIds(findingsRef.current, sorted);
            if (fresh.length > 0) setSealAnimating(fresh);
          }
          setFindings(sorted);
          // a Re-test makes the roadmap and the client report again (R84)
          const stageResult = await readStage(status, accessCode, controller.signal);
          if (cancelled) return;
          setStage(stageResult.bundle);
          setStageError(stageResult.error);
        }
        setRetestRunning(false);
      } catch (caught) {
        if (cancelled || caught instanceof RequestCancelledError) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setRetestRunning(false);
          setGone(true);
          setError(caught.message);
          return;
        }
        // Stop here; Retry resumes the polling.
        setPollError(handleApiError(caught));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [accessCode, handleApiError, id, pollTick, retestRunning]);

  useEffect(() => {
    if (!audit || !findings || loading || gone) return;
    const retestActive = retestRunning || audit.lastRetest?.status === 'running';
    evaluateBadges({
      auditCompleted: audit.status === 'completed',
      retestActive,
      lastRetestStatus: audit.lastRetest?.status ?? null,
      findings,
      // tables and secret keys in the scripts of the site (R73)
      leaked: leakCount(audit.summary),
      blocked: audit.summary.blocked,
      cleanup: audit.cleanup,
      actionObserved: retestAsked.current,
    });
    if (!retestActive) {
      // The certificate lock opens with an animation only when this Re-test
      // made the audit eligible (R68). A refresh shows it open, without it.
      const lock = certificateLock({
        status: audit.status,
        retestActive,
        leaked: leakCount(audit.summary),
        blocked: audit.summary.blocked,
        cleanup: audit.cleanup,
      });
      if (
        shouldPlayUnlock({
          eligibleAtStart: eligibleAtStart.current,
          eligibleNow: lock.eligible,
          actionObserved:
            retestAsked.current && audit.lastRetest?.status === 'completed',
          alreadyPlayed: unlockPlayed.current,
        })
      ) {
        unlockPlayed.current = true;
        setPlayUnlock(true);
      }
    }
    // The result of the user's Re-test has been seen, finished or failed.
    if (!retestActive) retestAsked.current = false;
  }, [audit, evaluateBadges, findings, gone, loading, retestRunning]);

  async function startRetest() {
    if (!accessCode) return;
    setRetestError('');
    setRetestStarting(true);
    try {
      await retest(
        id,
        {
          anonKey: retestAnonKey,
          serviceKey: retestServiceKey,
          confirmTestProject: true,
        },
        accessCode,
      );
      // Cleared only after the server accepted the Re-test (R29).
      setRetestAnonKey('');
      setRetestServiceKey('');
      setRetestConfirmed(false);
      setShowRetestForm(false);
      eligibleAtStart.current = certificateLock({
        status: audit?.status,
        retestActive: false,
        leaked: leakCount(audit?.summary),
        blocked: audit?.summary.blocked ?? 0,
        cleanup: audit?.cleanup,
      }).eligible;
      unlockPlayed.current = false;
      retestAsked.current = true;
      setRetestRunning(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setGone(true);
        setError(caught.message);
        return;
      }
      // The keys stay in memory so the user can send again.
      setRetestError(handleApiError(caught));
    } finally {
      setRetestStarting(false);
    }
  }

  // A 404 from Approve fix can mean an unknown finding or a gone audit.
  async function checkAuditStillExists() {
    if (!accessCode) return;
    try {
      await getAudit(id, accessCode);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setGone(true);
        setError(caught.message);
      }
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
  const lastRetest = audit?.lastRetest ?? null;
  // While a Re-test runs the old findings stay, each shown as "running" (R50).
  const retestActive = retestRunning || lastRetest?.status === 'running';
  const shownFindings =
    findings && retestActive
      ? findings.map((finding) => ({
          ...finding,
          retest: { ...finding.retest, status: 'running' as const },
        }))
      : findings;
  // R73: a leak is a leaking table or a secret key in a script of the site
  const leakedCount = leakCount(audit?.summary);
  const blockedCount = audit?.summary.blocked ?? 0;
  const inconclusiveCount = audit?.summary.inconclusive ?? 0;
  // The same rule as before, in one place (R68).
  const lock = certificateLock({
    status: audit?.status,
    retestActive,
    leaked: leakedCount,
    blocked: blockedCount,
    cleanup: audit?.cleanup,
  });
  const stages = audit ? hasStages(audit) : false;
  const headline = audit ? headlineOf(audit, stage?.clientReport ?? null) : null;
  const buckets = stages
    ? bucketsOf(stage?.clientReport, stage?.evidence?.coverage, audit?.plan)
    : null;
  const fixedIds = new Set(
    (findings ?? []).filter(isVerifiedFixed).map((finding) => finding.id),
  );

  return (
    <div className="shell page-stack">
      <div className="report-heading">
        <div>
          <h1>{audit?.target.label ?? 'Audit report'}</h1>
          {audit ? (
            <ul className="target-lines">
              {targetLines(audit.target).map((line) => (
                <li key={line.kind}>
                  <span className="target-kind">
                    {line.kind === 'website' ? 'Website' : 'Supabase'}
                  </span>
                  <span className="muted break">{line.url}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {stages ? <LangToggle lang={language} onChange={setLanguage} /> : null}
      </div>

      {audit?.cleanup === 'failed' ? (
        <CleanupWarning note={audit.cleanupNote} />
      ) : null}

      {stages ? (
        <>
          <GateBanner gate={audit?.gate} headline={headline} lang={language} />
          {stageError ? (
            <div className="notice notice-info" role="status">
              {t(language, 'stageError')} {stageError}
            </div>
          ) : null}
          <ClientSummary
            report={stage?.clientReport ?? null}
            roadmapItems={stage?.roadmap?.items}
            summary={audit?.summary}
            hasWebsite={Boolean(audit?.target.websiteUrl)}
            hasSupabase={Boolean(audit?.target.projectUrl)}
            lang={language}
          />
          <ScopeBuckets buckets={buckets} lang={language} />
        </>
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
          <BeforeAfter
            findings={findings}
            lastRetest={retestActive ? null : lastRetest}
          />

          <section className="card report-toolbar">
            <div className="toolbar-row">
              <div className="toolbar-group">
                <span className="toolbar-label">Explanation</span>
                <LangToggle lang={language} onChange={setLanguage} />
              </div>

              <div className="toolbar-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => setShowRetestForm((open) => !open)}
                  disabled={
                    retestActive ||
                    retestStarting ||
                    audit?.status !== 'completed' ||
                    rateLimitSecondsLeft > 0 ||
                    !findings
                  }
                >
                  {retestActive || retestStarting
                    ? 'Re-test running…'
                    : 'Re-test'}
                </button>
                {audit?.status === 'completed' ? (
                  <CertificateAction
                    auditId={id}
                    lock={lock}
                    playUnlock={playUnlock}
                    onPlayed={finishUnlock}
                  />
                ) : null}
              </div>
            </div>

            {showRetestForm && !retestActive ? (
              <RetestForm
                anonKey={retestAnonKey}
                serviceKey={retestServiceKey}
                confirmed={retestConfirmed}
                onAnonKey={setRetestAnonKey}
                onServiceKey={setRetestServiceKey}
                onConfirmed={setRetestConfirmed}
                onSubmit={() => void startRetest()}
                onCancel={() => setShowRetestForm(false)}
                submitting={retestStarting}
                blocked={rateLimitSecondsLeft > 0}
                error={retestError}
              />
            ) : null}

            {retestActive || retestStarting ? (
              <div className="notice notice-info" role="status">
                <span className="spinner spinner-small" aria-hidden="true" />
                Re-test is running. The page polls every 2 seconds and reads the
                findings again when it finishes.
              </div>
            ) : null}

            {pollError ? (
              <ErrorBanner
                message={pollError}
                onRetry={
                  rateLimitSecondsLeft === 0
                    ? () => setPollTick((tick) => tick + 1)
                    : undefined
                }
              />
            ) : null}

            {!showRetestForm && retestError ? (
              <ErrorBanner message={retestError} />
            ) : null}
            <RateLimitNotice />
          </section>

          {!stages || (findings && findings.length > 0) ? (
          <section className="card summary-card">
            {!stages ? (
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
            ) : null}
            <FixProgress findings={findings} retestActive={retestActive} />
            {!stages && leakedCount === 0 && blockedCount >= 1 ? (
              <>
                <p className="no-leak-line">No leak found by these checks.</p>
                {inconclusiveCount > 0 ? (
                  <p className="muted small">
                    {unverifiedText(inconclusiveCount)}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
          ) : null}

          <BadgeStrip
            state={badges.state}
            celebrating={badges.celebrating}
            onCelebrated={badges.finishCelebration}
            inconclusiveCount={inconclusiveCount}
          />

          {!retestActive && lastRetest?.status === 'completed' ? (
            <div className="notice notice-success" role="status">
              Re-test finished. The findings below were read again.
            </div>
          ) : null}

          {!retestActive && lastRetest?.status === 'failed' ? (
            <ErrorBanner
              message={`Re-test failed: ${
                lastRetest.error?.message ?? 'It stopped before it finished.'
              } The findings below are from before the Re-test.`}
            />
          ) : null}

          {!retestActive && lastRetest?.status === 'completed'
            ? lastRetest.tablesAdded.map((table) => (
                <div
                  className="notice notice-info"
                  role="status"
                  key={`added-${table}`}
                >
                  New table found in the last re-test: {table}
                </div>
              ))
            : null}

          {!retestActive && lastRetest?.status === 'completed'
            ? lastRetest.tablesRemoved.map((table) => (
                <div
                  className="notice notice-info"
                  role="status"
                  key={`removed-${table}`}
                >
                  {table}: This table was not checked in the last re-test.
                </div>
              ))
            : null}

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
              <p className="muted">These checks returned no findings.</p>
            </div>
          ) : null}

          <div className="findings-grid">
            {shownFindings?.map((finding) => (
              <FindingCard
                key={finding.id}
                auditId={id}
                finding={finding}
                language={language}
                actionsDisabled={
                  retestActive || retestStarting || audit?.status === 'running'
                }
                sealed={fixedIds.has(finding.id)}
                sealAnimate={sealAnimating.includes(finding.id)}
                onSealDone={finishSeal}
                onUpdated={updateFinding}
                onNotFound={() => void checkAuditStillExists()}
              />
            ))}
          </div>

          <Disclaimer statement={stages ? '' : undefined}>
            {stage?.clientReport?.disclaimer ? (
              <p className="muted small">
                {pick(stage.clientReport.disclaimer, language)}
              </p>
            ) : null}
            {!stages || audit?.target.projectUrl ? (
              <CoverageNotes summary="Checked, not covered and limits" />
            ) : null}
          </Disclaimer>
        </>
      )}
    </div>
  );
}
