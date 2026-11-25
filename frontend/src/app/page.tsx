'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useApp } from '@/components/app-provider';
import { CoverageNotes } from '@/components/coverage-notes';
import { ErrorBanner } from '@/components/error-banner';
import { HeroCard } from '@/components/hero-card';
import { HeroScene } from '@/components/hero-scene';
import { LangToggle } from '@/components/lang-toggle';
import {
  RepoGroup,
  SupabaseGroup,
  WebsiteGroup,
} from '@/components/connect-groups';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { WhatItChecks } from '@/components/what-it-checks';
import { startAudit } from '@/lib/api';
import { ApiError, NetworkError } from '@/lib/errors';
import {
  EMPTY_FIELDS,
  buildStartBody,
  checkConnect,
  clearKeys,
  startButtonLabel,
  startHintOf,
  startNote,
  willCheckLine,
  type ConnectFields,
} from '@/lib/form';
import {
  ADVANCED,
  FORM,
  KICKER,
  MEANING,
  PROBLEM,
  SCENE_NOTE,
  STEPS,
  TABLE_STEPS,
  headlineWords,
  honestyLine,
  pickText,
} from '@/lib/hero-copy';
import { useApiError } from '@/lib/use-api-error';
import { useLang } from '@/lib/use-lang';


export default function ConnectPage() {
  const router = useRouter();
  const {
    accessCode,
    setAccessCode,
    accessDraft,
    setAccessDraft,
    clearAccessCode,
    rateLimitSecondsLeft,
  } = useApp();
  const handleApiError = useApiError();
  const [lang, setLang] = useLang();
  const HEADLINE = headlineWords(lang);
  const HEADLINE_TEXT = HEADLINE.join(' ');

  // the website part (under the button) and the Supabase part (at the bottom)
  // are closed at first
  const [websiteAsked, setWebsiteAsked] = useState(false);
  const [advancedAsked, setAdvancedAsked] = useState(false);
  const [fields, setFields] = useState<ConnectFields>(EMPTY_FIELDS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [canRetry, setCanRetry] = useState(false);

  function change(patch: Partial<ConnectFields>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  const effectiveAccessCode = accessCode || accessDraft;
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
      ? startHintOf(check, Boolean(effectiveAccessCode), lang)
      : '';
  // A part stays open while anything is typed in it: a half-filled group must
  // never be hidden, because the start button waits for it.
  const websiteOpen = websiteAsked || check.website.state !== 'empty';
  const advancedOpen = advancedAsked || check.supabase.state !== 'empty';
  const willCheck = willCheckLine(check, lang);

  async function runAudit() {
    if (!check.canStart) {
      setError(startNote(check, lang));
      setCanRetry(false);
      return;
    }
    if (!effectiveAccessCode) {
      setError(pickText(FORM.needCode, lang));
      setCanRetry(false);
      return;
    }
    if (!accessCode && accessDraft) {
      setAccessCode(accessDraft);
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
      setAccessDraft('');
      router.push(`/audits/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAccessDraft('');
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

  return (
    <div className="shell page-stack">
      {/* wide screens: the words and the form on the left, the example result on
          the right; narrower: one column, the form first */}
      <section className="hero hero-stage">
        <div className="hero-copy">
          <div className="hero-copy-top">
            <p className="hero-kicker">{pickText(KICKER, lang)}</p>
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
          <p className="hero-problem">{pickText(PROBLEM, lang)}</p>

          {/* one field, one box, one button; the website opens under the button */}
          <div className="start-wrap">
          <form
            id="start-box"
            className="start-box"
            aria-label={pickText(FORM.start, lang)}
            onSubmit={submit}
            noValidate
          >
            <RepoGroup fields={fields} check={check} onChange={change} lang={lang} />

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
              {submitting
                ? pickText(FORM.starting, lang)
                : startButtonLabel(check, lang)}
            </button>
            {willCheck ? (
              <p className="will-check" id="will-check" role="status">
                {willCheck}
              </p>
            ) : null}
            {startHint ? (
              <p className="muted small" id="start-hint" role="status">
                {startHint}
              </p>
            ) : null}

            <button
              type="button"
              className="text-button website-toggle"
              aria-expanded={websiteOpen}
              aria-controls="website-more"
              onClick={() => setWebsiteAsked((open) => !open)}
            >
              {pickText(FORM.addWebsite, lang)}
            </button>
            <div id="website-more" hidden={!websiteOpen}>
              <WebsiteGroup fields={fields} check={check} onChange={change} lang={lang} />
            </div>

            <p className="fine-print">{pickText(FORM.noAi, lang)}</p>
          </form>
          </div>
        </div>

        {/* the example result, in one place only: beside the form, or under it on a narrow screen */}
        <div className="hero-card-wrap">
          <HeroCard lang={lang} />
          <button
            type="button"
            className="button button-ghost button-small hero-replay"
            onClick={() => window.dispatchEvent(new Event('vca:replay-hero'))}
          >
            Replay intro
          </button>
        </div>
      </section>

      <WhatItChecks lang={lang} />

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

      <section className="card truth-card">
        <h2>{pickText(MEANING.title, lang)}</h2>
        <p>
          {pickText(MEANING.cleanLead, lang)}{' '}
          <strong>{pickText(MEANING.clean, lang)}</strong>.
        </p>
        <CoverageNotes summary={pickText(MEANING.covers, lang)} />
        <dl className="truth-legend">
          {(['leaked', 'inconclusive', 'blocked'] as const).map((kind) => (
            <div key={kind}>
              <dt className={`legend-dot legend-${kind}`} />
              <dd>
                <strong>{pickText(MEANING[kind].word, lang)}</strong>
                <span>{pickText(MEANING[kind].body, lang)}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* the Supabase test project: the last thing on the page, closed at first */}
      <details
        className="card advanced"
        id="advanced-supabase"
        open={advancedOpen}
        onToggle={(event) => setAdvancedAsked(event.currentTarget.open)}
      >
        <summary className="advanced-summary">
          {pickText(ADVANCED.link, lang)}
        </summary>
        <div className="advanced-body">
          <SupabaseGroup fields={fields} check={check} onChange={change} lang={lang} />
          <p className="fine-print">{pickText(ADVANCED.keys, lang)}</p>
          <p className="fine-print">{pickText(ADVANCED.groq, lang)}</p>
          <p>
            <a className="text-link" href="#start-box">
              {pickText(ADVANCED.back, lang)}
            </a>
          </p>
          <h2>{pickText(ADVANCED.howTitle, lang)}</h2>
          <ol className="steps">
            {TABLE_STEPS.map((step, index) => (
              <li key={index}>
                <span>{index + 1}</span>
                <div>
                  <strong>{pickText(step.title, lang)}</strong>
                  <p>{pickText(step.body, lang)}</p>
                </div>
              </li>
            ))}
          </ol>
          {/* the picture of the table check: a canary on a post, a stranger at a barrier, a key in a window */}
          <p className="scene-note">{pickText(SCENE_NOTE, lang)}</p>
          <HeroScene lang={lang} />
        </div>
      </details>
    </div>
  );
}
