'use client';

import { useState } from 'react';
import type { Lang } from '@/lib/check-labels';
import { t } from '@/lib/stage-copy';

// The fix prompt of a roadmap item: a fixed text to paste into the AI tool that
// built the app. English first, Roman Urdu as the second copy, each with its own
// Copy button. The text comes from the backend as given. It never holds a key.
function PromptBlock({
  label,
  text,
  lang,
}: {
  label: string;
  text: string;
  lang: Lang;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="fix-prompt-block">
      <div className="fix-prompt-bar">
        <span className="fix-prompt-lang">{label}</span>
        <button type="button" className="fix-prompt-copy" onClick={copy}>
          {state === 'copied' ? t(lang, 'copiedPrompt') : t(lang, 'copyPrompt')}
        </button>
      </div>
      <pre className="fix-prompt-text">{text}</pre>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? t(lang, 'copiedPrompt') : ''}
      </span>
      {state === 'failed' ? (
        <p className="muted small">{t(lang, 'copyFailed')}</p>
      ) : null}
    </div>
  );
}

export function FixPrompt({
  prompt,
  lang,
}: {
  prompt: { en?: string; ur?: string };
  lang: Lang;
}) {
  return (
    <div className="fix-prompt">
      <h3>{t(lang, 'fixPromptHeading')}</h3>
      <p className="muted small">{t(lang, 'fixPromptHint')}</p>
      <PromptBlock label="English" text={prompt.en ?? ''} lang={lang} />
      {prompt.ur ? (
        <PromptBlock label="Roman Urdu" text={prompt.ur} lang={lang} />
      ) : null}
    </div>
  );
}
