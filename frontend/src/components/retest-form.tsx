'use client';

import type { FormEvent } from 'react';
import { ErrorBanner } from './error-banner';
import { SecretInput } from './secret-input';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

// The keys live in the parent's memory state only (R26). The Re-test needs
// both keys again every time and the test-project tick (R33, R6).
export function RetestForm({
  anonKey,
  serviceKey,
  confirmed,
  onAnonKey,
  onServiceKey,
  onConfirmed,
  onSubmit,
  onCancel,
  submitting,
  blocked,
  error,
}: {
  anonKey: string;
  serviceKey: string;
  confirmed: boolean;
  onAnonKey: (value: string) => void;
  onServiceKey: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  blocked: boolean;
  error: string;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  const canSubmit =
    confirmed && anonKey.trim() !== '' && serviceKey.trim() !== '';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit && !submitting && !blocked) onSubmit();
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <p className="muted small">
        {w('Enter both keys again. They are kept in this page’s memory only and are never returned by the server.')}
      </p>
      <div className="field-row">
        <label className="field">
          <span>{w('Publishable key')}</span>
          <SecretInput
            value={anonKey}
            onChange={(event) => onAnonKey(event.target.value)}
            maxLength={4096}
            required
          />
        </label>
        <label className="field">
          <span>{w('Secret key')}</span>
          <SecretInput
            value={serviceKey}
            onChange={(event) => onServiceKey(event.target.value)}
            maxLength={4096}
            required
          />
        </label>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmed(event.target.checked)}
        />
        <span>
          {w('I confirm this is a TEST project, not production.')}
        </span>
      </label>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="toolbar-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={!canSubmit || submitting || blocked}
        >
          {w(submitting ? 'Starting re-test…' : 'Start re-test')}
        </button>
        <button
          type="button"
          className="button button-ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          {w('Cancel')}
        </button>
      </div>
    </form>
  );
}
