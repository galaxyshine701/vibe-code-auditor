'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useApp } from '@/components/app-provider';
import { CoverageNotes } from '@/components/coverage-notes';
import { ErrorBanner } from '@/components/error-banner';
import { HeroCard } from '@/components/hero-card';
import { LangToggle } from '@/components/lang-toggle';
import { ConnectGroups } from '@/components/connect-groups';
import { SecretInput } from '@/components/secret-input';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { startAudit } from '@/lib/api';
import { PROJECT_TAGLINE } from '@/lib/brand';
import { ApiError, NetworkError } from '@/lib/errors';
import {
  EMPTY_FIELDS,
  buildStartBody,
  checkConnect,
  clearKeys,
  startHintOf,
  startNote,
  type ConnectFields,
} from '@/lib/form';
import {
  CHIPS,
  STEPS,
  headlineWords,
  honestyLine,
  pickText,
  subLine,
  type ChipId,
} from '@/lib/hero-copy';
import { useApiError } from '@/lib/use-api-error';
import { useLang } from '@/lib/use-lang';


export default function ConnectPage() {
  const router = useRouter();
  const {
    accessCode,
    setAccessCode,
    clearAccessCode,
    rateLimitSecondsLeft,
  } = useApp();
  const handleApiError = useApiError();
  const [lang, setLang] = useLang();
  const HEADLINE = headlineWords(lang);
  const HEADLINE_TEXT = HEADLINE.join(' ');

  // A chip points at the group of the Connect form it is named after (Both: at
  // both). The group says "here" for a moment.
  function pickSource(chip: ChipId) {
    const first = document.getElementById(
      chip === 'supabase' ? 'project-url' : 'website-url',
    );
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    first?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    first?.focus({ preventScroll: true });
    const groups = document.querySelectorAll<HTMLElement>('.source-group');
    const wanted =
      chip === 'both' ? [...groups] : [groups[chip === 'supabase' ? 1 : 0]];
    for (const group of wanted) {
      if (!group) continue;
      group.classList.remove('is-nudged');
      void group.offsetWidth;
      group.classList.add('is-nudged');
      window.setTimeout(() => group.classList.remove('is-nudged'), 1500);
    }
  }

  const [fields, setFields] = useState<ConnectFields>(EMPTY_FIELDS);
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [canRetry, setCanRetry] = useState(false);

  function change(patch: Partial<ConnectFields>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  const effectiveAccessCode = accessCode || accessCodeInput;
  // R76: at least one group complete, and no group half filled.
  const check = checkConnect(fields);
  const startDisabled =
    submitting ||
    !check.canStart ||
    rateLimitSecondsLeft > 0 ||
    !effectiveAccessCode;
  // Say what is missing, but not while submitting or rate-limited.
  const startHint =
    !submitting && rateLimitSecondsLeft === 0
      ? startHintOf(check, Boolean(effectiveAccessCode))
      : '';

  async function runAudit() {
    if (!check.canStart) {
      setError(startNote(check));
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
        buildStartBody(fields),
        effectiveAccessCode,
      );
      // after a 202 the keys are cleared; the website address may stay (R76)
      setFields(clearKeys);
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
          <div className="hero-copy-top">
            <p className="hero-kicker">{PROJECT_TAGLINE}</p>
            <LangToggle lang={lang} onChange={setLang} />
          </div>
          <h1
            className={lang === 'ur' ? 'hero-title hero-title-ur' : 'hero-title'}
            aria-label={HEADLINE_TEXT}
          >
            {HEADLINE.map((word, index) => (
              <span key={`${lang}-${index}`}>
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
          <p className="hero-lede">{subLine(lang)}</p>
          <div className="hero-chips" role="group" aria-label={pickText({ en: 'What to check', ur: 'Kya check karna hai' }, lang)}>
            {CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="hero-chip-btn"
                data-chip={chip.id}
                onClick={() => pickSource(chip.id)}
              >
                {pickText(chip.label, lang)}
              </button>
            ))}
          </div>

          <div className="hero-gate" id="access-gate">
            {!accessCode ? (
              <label className="field field-code">
                <span>Access code</span>
                <SecretInput
                  id="access-code"
                  value={accessCodeInput}
                  onChange={(event) => setAccessCodeInput(event.target.value)}
                  placeholder="Enter the door"
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
            <button
              type="button"
              className="button button-ghost button-small hero-replay"
              onClick={() => window.dispatchEvent(new Event('vca:replay-hero'))}
            >
              Replay intro
            </button>
          </div>
        </div>

        {/* the example run: a beam resolves three evidence rows, then the gate */}
        <div className="hero-card-wrap">
          <HeroCard lang={lang} />
        </div>
      </section>

      <ol className="hero-steps" aria-label={pickText({ en: 'How it works', ur: 'Kaise kaam karta hai' }, lang)}>
        {STEPS.map((step, index) => (
          <li className="hero-step" key={index}>
            <span className="hero-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <h2>{pickText(step.title, lang)}</h2>
            <p>{pickText(step.body, lang)}</p>
          </li>
        ))}
      </ol>
      <p className="hero-honesty">{honestyLine(lang)}</p>

      <div className="connect-grid">
        <section className="card form-card" aria-labelledby="start-heading">
          <div className="card-heading">
            <div>
              <h2 id="start-heading">Start an audit</h2>
              <p className="muted small">
                Connect a staging or test project.
              </p>
              <p className="muted small">
                The auditor adds two temporary users and one canary row per
                table, then removes them.
              </p>
              <p className="muted small">
                Table names and check results (never keys) are sent to Groq to write the explanation.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="stack" noValidate>
            <label className="field">
              <span>
                Label <em>optional</em>
              </span>
              <input
                type="text"
                value={fields.label}
                onChange={(event) => change({ label: event.target.value })}
                placeholder="Example shop (test project)"
                maxLength={120}
                autoComplete="off"
              />
              <small>Used only to name this run. Maximum 120 characters.</small>
            </label>

            <ConnectGroups fields={fields} check={check} onChange={change} />

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
              aria-describedby={startHint ? 'start-hint' : undefined}
            >
              {submitting ? 'Starting audit…' : 'Start audit'}
            </button>
            {startHint ? (
              <p className="muted small" id="start-hint" role="status">
                {startHint}
              </p>
            ) : null}
            <p className="fine-print">
              Keys stay in memory only. They are cleared from the form after the
              server accepts the audit. Refreshing the page clears the access
              code.
            </p>
          </form>
        </section>

        <aside className="stack">
          <section className="card info-card">
            <h2>How the table check works</h2>
            <ol className="steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Two temporary users</strong>
                  <p>
                    The auditor signs up user A and user B in your project.
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
              .
            </p>
            <CoverageNotes summary="See what they cover." />
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
