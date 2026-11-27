'use client';

import type { Lang } from '@/lib/check-labels';
import { SECTIONS, STEPS, VISUAL_COPY, pickText } from '@/lib/hero-copy';
import { SAMPLE_PROMPT } from './prompt-sample';
import { SectionHead } from './section-head';

// "How it works": three steps in a row, joined by a line (upright on a phone),
// each with a small picture of that moment, with real words in it: the field and
// its box, the checks running, the verdicts and a piece of a fix prompt. The
// pictures are hidden from a screen reader (the step says the same), and have no
// lock, no tick and no shield. The steps rise into view with the other cards of
// the page (reveal.tsx).

/** The first words of the real prompt, in three short lines; "…" says there is more. */
export function promptLines(prompt: string, width = 30, count = 3): string[] {
  const lines: string[] = [''];
  for (const word of prompt.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (!last) lines[lines.length - 1] = word;
    else if (last.length + word.length < width) lines[lines.length - 1] = `${last} ${word}`;
    else if (lines.length < count) lines.push(word);
    else {
      lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,:;]$/, '')}…`;
      break;
    }
  }
  return lines;
}

function Visual({ name, lang }: { name: (typeof STEPS)[number]['visual']; lang: Lang }) {
  if (name === 'paste') {
    return (
      <>
        <span className="mv-input">{VISUAL_COPY.address}</span>
        <span className="mv-agree">
          <span className="mv-box" />
          {pickText(VISUAL_COPY.agree, lang)}
        </span>
        <span className="mv-button">{pickText(VISUAL_COPY.button, lang)}</span>
      </>
    );
  }
  if (name === 'run') {
    return (
      <>
        {VISUAL_COPY.rows.map((row) => (
          <span className={`mv-row mv-row-${row.state}`} key={row.name.en}>
            <span className="mv-dot" />
            {pickText(row.name, lang)}
          </span>
        ))}
        <span className="mv-progress">
          <span />
        </span>
      </>
    );
  }
  return (
    <>
      <span className="mv-pills">
        <span className="mv-pill mv-pill-leaked">LEAKED</span>
        <span className="mv-pill mv-pill-inconclusive">INCONCLUSIVE</span>
        <span className="mv-pill mv-pill-blocked">BLOCKED</span>
      </span>
      <span className="mv-code">
        {promptLines(SAMPLE_PROMPT[lang]).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </>
  );
}

export function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <section className="home-section how" aria-labelledby="how-title" data-reveal-group>
      <SectionHead id="how-title" head={SECTIONS.how} lang={lang} />
      <ol className="how-steps glass-wrap">
        {STEPS.map((step, index) => (
          <li className="reveal" data-reveal="card" key={step.visual}>
            <div className="how-step glass">
              <div className={`how-visual how-visual-${step.visual}`} aria-hidden="true">
                <Visual name={step.visual} lang={lang} />
              </div>
              <span className="how-number" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{pickText(step.title, lang)}</h3>
              <p>{pickText(step.body, lang)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
