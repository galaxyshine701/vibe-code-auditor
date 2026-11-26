'use client';

import { useState } from 'react';
import type { Lang } from '@/lib/check-labels';
import { SAMPLE, pickText } from '@/lib/hero-copy';
import roadmap from '@/lib/mock-bundles/repo-only/roadmap.json';
import { CopyButton } from './copy-button';
import { LangToggle } from './lang-toggle';

// "A fix prompt, for example": the prompt of the key-in-a-file step of the
// repo-only example bundle, which the backend's code makes
// (fixRepoSecretPrompt; a test compares the two). Nothing of it is written
// here. The button copies the whole of it.
export const SAMPLE_PROMPT: { en: string; ur: string } = roadmap.items.find(
  (item) => item.kind === 'fix-repo-secret',
)!.fixPrompt!;

export function PromptSample({ lang }: { lang: Lang }) {
  // the language of the page, until the reader picks one for the prompt
  const [chosen, setChosen] = useState<Lang | null>(null);
  const shown = chosen ?? lang;

  return (
    <section className="prompt-sample glass" aria-labelledby="sample-title">
      <h3 id="sample-title">{pickText(SAMPLE.title, lang)}</h3>
      <p className="prompt-about">{pickText(SAMPLE.about, lang)}</p>
      <LangToggle lang={shown} onChange={setChosen} />
      <pre className="prompt-text">{SAMPLE_PROMPT[shown]}</pre>
      <CopyButton
        text={SAMPLE_PROMPT[shown]}
        label={pickText(SAMPLE.copy, lang)}
        copiedLabel={pickText(SAMPLE.copied, lang)}
      />
    </section>
  );
}
