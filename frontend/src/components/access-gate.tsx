'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useApp } from './app-provider';
import { RateLimitNotice } from './rate-limit-notice';

export function AccessGate({
  title = 'Access code required',
  description = 'Enter the access code to continue. It stays in this page’s memory only.',
}: {
  title?: string;
  description?: string;
}) {
  const { setAccessCode, rateLimitSecondsLeft, accessNotice } = useApp();
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
      <div className="card gate-card">
        <span className="eyebrow">Protected route</span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Access code</span>
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoFocus
              maxLength={4096}
              disabled={rateLimitSecondsLeft > 0}
            />
          </label>
          {error || accessNotice ? (
            <p className="inline-error" role="alert">
              {error || accessNotice}
            </p>
          ) : null}
          <RateLimitNotice />
          <button
            type="submit"
            className="button button-primary"
            disabled={rateLimitSecondsLeft > 0}
          >
            Continue
          </button>
        </form>
        <Link href="/" className="text-link">
          Start a new audit
        </Link>
      </div>
    </div>
  );
}
