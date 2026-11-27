import type { Lang } from '@/lib/check-labels';
import { Reveal } from './reveal';
import { SECTIONS, WHAT_IT_CHECKS, pickText } from '@/lib/hero-copy';
import { SectionHead } from './section-head';

// "What it checks": four cards under the hero, each with one line and what it
// reads, and one line that says what is not checked (the limits the checks themselves report).
// The icons are plain shapes in the colour of the text.
const ICONS = {
  // a file
  files: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  // a file name that starts with a dot
  env: <path d="M4 17h.01M9 7h11M9 12h11M9 17h7M4 7h.01M4 12h.01" />,
  // table rows
  migrations: <path d="M4 5h16v14H4zM4 10h16M4 14.5h16M10 10v9" />,
  // a browser window
  site: <path d="M3 5h18v14H3zM3 9.5h18M6 7.25h.01M8.5 7.25h.01M9 13l-2 2 2 2M15 13l2 2-2 2" />,
} as const;

export function WhatItChecks({ lang }: { lang: Lang }) {
  return (
    <section className="home-section checks-strip" aria-labelledby="checks-title" data-reveal-group>
      <SectionHead id="checks-title" head={SECTIONS.checks} lang={lang} />
      <ul className="checks-list glass-wrap">
        {WHAT_IT_CHECKS.items.map((item) => (
          <li className="reveal" data-reveal="card" key={item.icon}>
            <div className="checks-card glass">
              <svg
                className="checks-icon"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                {ICONS[item.icon]}
              </svg>
              <h3>{pickText(item.title, lang)}</h3>
              <p>{pickText(item.body, lang)}</p>
              <span className="reads-tag">{pickText(item.reads, lang)}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="glass-wrap">
        <Reveal>
          <div className="checks-skipped glass">
            <p>
              <strong>{pickText(WHAT_IT_CHECKS.notCheckedLead, lang)}</strong>
            </p>
            <ul>
              {WHAT_IT_CHECKS.notChecked.map((part) => (
                <li key={part.en}>{pickText(part, lang)}</li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
