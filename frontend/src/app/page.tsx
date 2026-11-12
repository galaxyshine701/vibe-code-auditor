'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useApp } from '@/components/app-provider';
import { ErrorBanner } from '@/components/error-banner';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { startAudit } from '@/lib/api';
import { API_BASE_URL, USE_MOCK } from '@/lib/config';
import { ApiError, NetworkError } from '@/lib/errors';
import { useApiError } from '@/lib/use-api-error';

export default function ConnectPage() {
  const router = useRouter();
  const { accessCode, setAccessCode, rateLimitSecondsLeft } = useApp();
  const handleApiError = useApiError();

  const [label, setLabel] = useState('');
  const [projectUrl, setProjectUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceKey, setServiceKey] = useState('');
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [canRetry, setCanRetry] = useState(false);

  const effectiveAccessCode = accessCode || accessCodeInput;
  const startDisabled =
    submitting || !confirmed || rateLimitSecondsLeft > 0 || !effectiveAccessCode;

  async function runAudit() {
    if (!confirmed) {
      setError('Confirm that this is a TEST project before starting.');
      setCanRetry(false);
      return;
    }
    if (!effectiveAccessCode) {
      setError('Enter the access code before starting.');
      setCanRetry(false);
      return;
    }
    if (!accessCode && accessCodeInput) {
      setAccessCode(accessCodeInput);
    }

    setSubmitting(true);
    setError('');
    setCanRetry(false);

    try {
      const created = await startAudit(
        {
          projectUrl: projectUrl.trim(),
          anonKey,
          serviceKey,
          confirmTestProject: true,
          ...(label.trim() ? { label: label.trim() } : {}),
        },
        effectiveAccessCode,
      );
      setAnonKey('');
      setServiceKey('');
      router.push(`/audits/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAccessCodeInput('');
      }
      setError(handleApiError(caught));
      setCanRetry(caught instanceof NetworkError);
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAudit();
  }

  return (
    <div className="shell page-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">Data Access Prover</span>
          <h1>
            See what another user can
            <span className="gradient-text"> read or change.</span>
          </h1>
          <p className="hero-copy">
            The auditor creates two temporary users in your test Supabase
            project, plants a canary row for the first user, and tries to reach
            it as the second. You get evidence, not a guess.
          </p>
          <ul className="trust-list">
            <li>Two temporary test users, removed afterwards</li>
            <li>Canary rows in your own test project</li>
            <li>Findings with a copyable reproducer and fix SQL</li>
          </ul>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-card orbit-user-a">
            <span className="orbit-dot dot-a" />
            User A
            <small>owns the row</small>
          </div>
          <div className="orbit-line" />
          <div className="orbit-card orbit-user-b">
            <span className="orbit-dot dot-b" />
            User B
            <small>tries to read it</small>
          </div>
          <div className="orbit-verdict">LEAKED?</div>
        </div>
      </section>

      <div className="connect-grid">
        <section className="card form-card" aria-labelledby="start-heading">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Connect</span>
              <h2 id="start-heading">Start an audit</h2>
            </div>
            <span className="step-chip">Step 1 of 4</span>
          </div>

          <form onSubmit={submit} className="stack" noValidate>
            <label className="field">
              <span>
                Label <em>optional</em>
              </span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Hotel booking (test project)"
                maxLength={120}
                autoComplete="off"
              />
              <small>Used only to name this run. Maximum 120 characters.</small>
            </label>

            <label className="field">
              <span>Project URL</span>
              <input
                type="url"
                value={projectUrl}
                onChange={(event) => setProjectUrl(event.target.value)}
                placeholder="https://example-project.supabase.co"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <small>
                Plain origin only: https://&lt;project-ref&gt;.supabase.co
              </small>
            </label>

            <div className="field-row">
              <label className="field">
                <span>Publishable key</span>
                <input
                  type="password"
                  value={anonKey}
                  onChange={(event) => setAnonKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  required
                />
                <small>Sent as anonKey. Never returned by the server.</small>
              </label>

              <label className="field">
                <span>Secret key</span>
                <input
                  type="password"
                  value={serviceKey}
                  onChange={(event) => setServiceKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  required
                />
                <small>Sent as serviceKey. Never returned by the server.</small>
              </label>
            </div>

            {!accessCode ? (
              <label className="field">
                <span>Access code</span>
                <input
                  type="password"
                  value={accessCodeInput}
                  onChange={(event) => setAccessCodeInput(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  required
                />
                <small>
                  Kept in this page’s memory only, then sent as X-Access-Code.
                </small>
              </label>
            ) : (
              <div className="memory-chip">
                <span className="memory-dot" aria-hidden="true" />
                Access code held in memory for this page only
              </div>
            )}

            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I confirm this is a <strong>TEST project</strong>, not
                production. The auditor creates and removes temporary users and
                canary rows.
              </span>
            </label>

            <RateLimitNotice />
            {error ? (
              <ErrorBanner
                message={error}
                onRetry={canRetry ? () => void runAudit() : undefined}
              />
            ) : null}

            <button
              type="submit"
              className="button button-primary button-large"
              disabled={startDisabled}
            >
              {submitting ? 'Starting audit…' : 'Start audit'}
            </button>
            <p className="fine-print">
              Keys stay in memory only. They are cleared from the form after the
              server accepts the audit. Refreshing the page clears the access
              code.
            </p>
          </form>
        </section>

        <aside className="stack">
          <section className="card info-card">
            <span className="eyebrow">How it works</span>
            <ol className="steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Two temporary users</strong>
                  <p>
                    The auditor signs up user A and user B in your test project.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>A canary row</strong>
                  <p>
                    User A owns a new row. User B and a visitor try to read,
                    change and delete it.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Evidence you can check</strong>
                  <p>
                    Every finding shows what the API answered and a reproducer
                    with placeholders.
                  </p>
                </div>
              </li>
            </ol>
          </section>

          <section className="card truth-card">
            <span className="eyebrow">What this means</span>
            <p>
              A clean result means <strong>no leak found by these checks</strong>
              . It is not a guarantee that the app is secure.
            </p>
            <dl className="truth-legend">
              <div>
                <dt className="legend-dot legend-leaked" />
                <dd>
                  <strong>Leaked</strong>
                  <span>Another user reached the canary row.</span>
                </dd>
              </div>
              <div>
                <dt className="legend-dot legend-inconclusive" />
                <dd>
                  <strong>Inconclusive</strong>
                  <span>A person should confirm the intent.</span>
                </dd>
              </div>
              <div>
                <dt className="legend-dot legend-blocked" />
                <dd>
                  <strong>Blocked</strong>
                  <span>The row stayed private in these checks.</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="card server-card">
            <span className="eyebrow">Connection</span>
            <p className="mono-small break">{API_BASE_URL}</p>
            <p className="muted small">
              {USE_MOCK
                ? 'Demo data mode is on, so no real request is sent.'
                : 'Every audit request sends the access code in a header, never in the URL.'}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
