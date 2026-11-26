'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useApp } from '@/components/app-provider';
import { ErrorBanner } from '@/components/error-banner';
import { HeroCard } from '@/components/hero-card';
import { HeroScene } from '@/components/hero-scene';
import { HowItWorks } from '@/components/how-it-works';
import { LangToggle } from '@/components/lang-toggle';
import {
  RepoGroup,
  SupabaseGroup,
  WebsiteGroup,
} from '@/components/connect-groups';
import { RateLimitNotice } from '@/components/rate-limit-notice';
import { SectionHead } from '@/components/section-head';
import { WhatItChecks } from '@/components/what-it-checks';
import { WordMeanings } from '@/components/word-meanings';
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
  GET,
  KICKER,
  PROBLEM,
  SCENE_NOTE,
  SECTIONS,
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
    <div className="shell home">
      {/* wide screens: the words and the form on the left, the scene on the
          right; narrower: one column, the form first */}
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
          <div className="start-wrap glass-wrap">
          <form
            id="start-box"
            className="start-box glass"
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

        {/* the picture of the three words: it plays again and again */}
        <div className="hero-visual">
          <div className="glass-wrap">
            <HeroScene lang={lang} />
          </div>
          <p className="scene-note">{pickText(SCENE_NOTE, lang)}</p>
        </div>
      </section>

      <WhatItChecks lang={lang} />
      <HowItWorks lang={lang} />

      <section className="home-section get" aria-labelledby="get-title">
        <div className="get-text">
          <SectionHead id="get-title" head={SECTIONS.get} lang={lang} />
          <p>{pickText(GET.body, lang)}</p>
          <ul className="get-points">
            {GET.points.map((point) => (
              <li key={point.en}>{pickText(point, lang)}</li>
            ))}
          </ul>
          <p className="hero-honesty">{honestyLine(lang)}</p>
        </div>
        {/* the example result, here and nowhere else */}
        <div className="hero-card-wrap glass-wrap">
          <HeroCard lang={lang} />
        </div>
      </section>

      <WordMeanings lang={lang} />

      {/* the Supabase test project: the last thing on the page, closed at first */}
      <section className="home-section" aria-labelledby="advanced-title">
        <SectionHead id="advanced-title" head={SECTIONS.advanced} lang={lang} />
      <details
        className="advanced glass"
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
        </div>
      </details>
      </section>
    </div>
  );
}
