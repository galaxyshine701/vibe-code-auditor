'use client';

import { Reveal } from './reveal';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';
import { useApp } from './app-provider';
import { SecretInput } from './secret-input';
import { RateLimitNotice } from './rate-limit-notice';

export function AccessGate({
  title = 'Access code required',
  description = 'Enter the access code to continue. It stays in this page’s memory only.',
}: {
  title?: string;
  description?: string;
}) {
  const { setAccessCode, rateLimitSecondsLeft, accessNotice } = useApp();
  const [lang] = useLang();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code) {
      setError('Enter the access code.');
      return;
    }
    setError('');
    setAccessCode(code);
  }

  return (
    <div className="gate-wrap">
      <div className="result-cards glass-wrap">
        <Reveal>
          <div className="card gate-card glass">
            <h1>{uiText(title, lang)}</h1>
            <p className="muted">{uiText(description, lang)}</p>
            <form onSubmit={submit} className="stack">
              <label className="field">
                <span>{uiText('Access code', lang)}</span>
                <SecretInput
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoFocus
                  maxLength={4096}
                  disabled={rateLimitSecondsLeft > 0}
                />
              </label>
              {error || accessNotice ? (
                <p className="inline-error" role="alert">
                  {uiText(error || accessNotice, lang)}
                </p>
              ) : null}
              <RateLimitNotice />
              <button
                type="submit"
                className="button button-primary"
                disabled={rateLimitSecondsLeft > 0}
              >
                {uiText('Continue', lang)}
              </button>
            </form>
            <Link href="/" className="text-link">
              {uiText('Start a new audit', lang)}
            </Link>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
