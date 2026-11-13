'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useApp } from '@/components/app-provider';
import { ErrorBanner } from '@/components/error-banner';
import { HeroMotion } from '@/components/hero-motion';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { startAudit } from '@/lib/api';
import { ApiError, NetworkError } from '@/lib/errors';
import { useApiError } from '@/lib/use-api-error';

const HEADLINE = ['Can', 'another', 'user', 'read', 'your', 'data?'];

export default function ConnectPage() {
  const router = useRouter();
  const {
    accessCode,
    setAccessCode,
    clearAccessCode,
    rateLimitSecondsLeft,
  } = useApp();
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
      setError('Enter the access code in the hero first.');
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
        clearAccessCode();
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

  function changeAccessCode() {
    clearAccessCode();
    setAccessCodeInput('');
  }

  return (
    <div className="shell page-stack">
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">Data access prover</p>
          <h1 className="hero-title" aria-label="Can another user read your data?">
            {HEADLINE.map((word, index) => (
              <span key={word}>
                <span
                  className="hero-word"
                  style={{ animationDelay: `${150 + index * 90}ms` }}
                >
                  {word}
                </span>
                {index < HEADLINE.length - 1 ? ' ' : null}
              </span>
            ))}
          </h1>
          <p className="hero-lede">
            Two temporary users, one canary row. The auditor tries to reach it
            and shows you exactly what answered.
          </p>

          <div className="hero-gate" id="access-gate">
            {!accessCode ? (
              <label className="field field-code">
                <span>Access code</span>
                <input
                  id="access-code"
                  type="password"
                  value={accessCodeInput}
                  onChange={(event) => setAccessCodeInput(event.target.value)}
                  placeholder="Enter the door"
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={4096}
                />
                <small>
                  Kept in this page’s memory only. It unlocks the run and is
                  sent as a header, never in the URL.
                </small>
              </label>
            ) : (
              <div className="memory-chip">
                <span className="memory-dot" aria-hidden="true" />
                <span>Access code held for this page only.</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={changeAccessCode}
                >
                  Change
                </button>
              </div>
            )}
            <p className="hero-gate-note">
              This is the door. The temporary users and canary rows are created
              only after you enter it.
            </p>
          </div>
        </div>

        <HeroMotion />
      </section>

      <div className="connect-grid">
        <section className="card form-card" aria-labelledby="start-heading">
          <div className="card-heading">
            <div>
              <h2 id="start-heading">Start an audit</h2>
              <p className="muted small">
                Use a Supabase test project, never production.
              </p>
            </div>
            <span className="pill pill-outline">Test project</span>
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
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={4096}
                  required
                />
                <small>Never returned by the server.</small>
              </label>

              <label className="field">
                <span>Secret key</span>
                <input
                  type="password"
                  value={serviceKey}
                  onChange={(event) => setServiceKey(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={4096}
                  required
                />
                <small>Never returned by the server.</small>
              </label>
            </div>

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
            <h2>How it works</h2>
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
            <h2>What this means</h2>
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
        </aside>
      </div>
    </div>
  );
}
