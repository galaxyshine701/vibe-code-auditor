import type { Lang } from '@/lib/check-labels';
import { WHAT_IT_CHECKS, pickText } from '@/lib/hero-copy';

// "What it checks": four short items under the hero, each with one line, and one
// line that says what is not checked (the limits the checks themselves report).
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
    <section className="checks-strip" aria-labelledby="checks-strip-title">
      <h2 id="checks-strip-title">{pickText(WHAT_IT_CHECKS.title, lang)}</h2>
      <ul className="checks-list">
        {WHAT_IT_CHECKS.items.map((item) => (
          <li key={item.icon}>
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
          </li>
        ))}
      </ul>
      <p className="checks-skipped">
        <strong>{pickText(WHAT_IT_CHECKS.notCheckedLead, lang)}</strong>{' '}
        {WHAT_IT_CHECKS.notChecked.map((part) => pickText(part, lang)).join(' · ')}
      </p>
    </section>
  );
}
