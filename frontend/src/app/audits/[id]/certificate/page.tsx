'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccessGate } from '@/components/access-gate';
import { useApp } from '@/components/app-provider';
import { Disclaimer } from '@/components/disclaimer';
import { ErrorBanner } from '@/components/error-banner';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { getCertificate } from '@/lib/api';
import {
  ApiError,
  RequestCancelledError,
} from '@/lib/errors';
import { formatDate } from '@/lib/format';
import type { Certificate } from '@/lib/types';
import { useApiError } from '@/lib/use-api-error';

export default function CertificatePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { accessCode, rateLimitSecondsLeft } = useApp();
  const handleApiError = useApiError();

  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [error, setError] = useState('');
  const [notEligible, setNotEligible] = useState(false);
  const [gone, setGone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!accessCode) return;

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setNotEligible(false);
    setGone(false);

    const load = async () => {
      try {
        const result = await getCertificate(
          id,
          accessCode,
          controller.signal,
        );
        if (cancelled) return;
        setCertificate(result);
        setLoading(false);
      } catch (caught) {
        if (cancelled || caught instanceof RequestCancelledError) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setGone(true);
          setError(caught.message);
          setLoading(false);
          return;
        }
        if (caught instanceof ApiError && caught.status === 409) {
          setNotEligible(true);
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
  }, [accessCode, handleApiError, id, retryTick]);

  if (!accessCode) {
    return (
      <AccessGate
        title="Access code required"
        description="Enter the access code to open this certificate view. It stays in this page’s memory only."
      />
    );
  }

  if (loading) {
    return (
      <div className="shell narrow-stack">
        <div className="card loading-card" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>Checking the certificate view…</strong>
            <p className="muted">This view stays inside the app.</p>
          </div>
        </div>
        <Disclaimer />
      </div>
    );
  }

  if (gone) {
    return (
      <div className="shell narrow-stack">
        <div className="card empty-card">
          <span className="eyebrow">Certificate unavailable</span>
          <h1>This audit no longer exists.</h1>
          <p className="muted">
            No audit with this id was found. Audits are kept in server memory,
            so a server restart removes them.
          </p>
          <Link href="/" className="button button-primary">
            Start a new audit
          </Link>
        </div>
        <Disclaimer />
      </div>
    );
  }

  return (
    <div className="shell narrow-stack">
      <Link href={`/audits/${id}/report`} className="back-link">
        <span aria-hidden="true">←</span> Back to report
      </Link>

      {notEligible ? (
        <section className="card empty-card">
          <span className="eyebrow">Certificate not available</span>
          <h1>This audit is not eligible yet.</h1>
          <p className="muted">{error}</p>
          <div className="action-row">
            <Link
              href={`/audits/${id}/report`}
              className="button button-primary"
            >
              Back to report
            </Link>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setRetryTick((tick) => tick + 1)}
              disabled={rateLimitSecondsLeft > 0}
            >
              Check again
            </button>
          </div>
          <RateLimitNotice />
        </section>
      ) : null}

      {!notEligible && error ? (
        <>
          <ErrorBanner
            message={error}
            onRetry={
              rateLimitSecondsLeft === 0
                ? () => setRetryTick((tick) => tick + 1)
                : undefined
            }
          />
          <RateLimitNotice />
        </>
      ) : null}

      {certificate ? (
        <section className="certificate-card">
          <div className="certificate-glow" aria-hidden="true" />
          <div className="certificate-top">
            <span className="seal" aria-hidden="true">
              VCA
            </span>
            <div>
              <span className="eyebrow">Certificate view</span>
              <h1>No leak found by these checks</h1>
            </div>
          </div>
          <p className="certificate-sub">
            Issued for audit <span className="mono-small">{certificate.auditId}</span>
          </p>

          <dl className="certificate-grid">
            <div>
              <dt>Issued at</dt>
              <dd>{formatDate(certificate.issuedAt)}</dd>
            </div>
            <div>
              <dt>Result code</dt>
              <dd className="mono-small">{certificate.result}</dd>
            </div>
            <div>
              <dt>Checks run</dt>
              <dd>{certificate.checksRun.join(', ')}</dd>
            </div>
            <div className="certificate-hash">
              <dt>Record hash</dt>
              <dd className="mono-small break">{certificate.recordHash}</dd>
            </div>
          </dl>

          <div className="certificate-disclaimer">
            <p>{certificate.disclaimer}</p>
          </div>
        </section>
      ) : null}

      <Disclaimer />

      <p className="muted center small">
        This view lives inside the app. There is no public link or share
        address.
      </p>
    </div>
  );
}
