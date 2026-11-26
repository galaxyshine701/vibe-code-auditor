'use client';

import { beforeAfter, changedAnything, type Counts } from '@/lib/outcome';
import type { Finding, LastRetest } from '@/lib/types';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

const ROWS: { key: keyof Counts; label: string; className: string }[] = [
  { key: 'leaked', label: 'Leaked', className: 'ba-leaked' },
  { key: 'inconclusive', label: 'Inconclusive', className: 'ba-inconclusive' },
  { key: 'blocked', label: 'Blocked', className: 'ba-blocked' },
];

// "Before -> After" after a Re-test that completed (R67). Worked out from the
// real findings, never from the copies shown as "running". Nothing is shown
// for a failed or a running Re-test. It is a count, not a score.
export function BeforeAfter({
  findings,
  lastRetest,
}: {
  findings: Finding[] | null;
  lastRetest: LastRetest | null;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  const result = beforeAfter(findings, lastRetest);
  if (!result) return null;

  const summary = ROWS.map(
    (row) =>
      `${w(row.label)} ${result.before[row.key]} ${uiLang === 'ur' ? 'se' : 'to'} ${result.after[row.key]}`,
  ).join(', ');

  return (
    <section className="card before-after" aria-label={w('Before and after the Re-test')}>
      <h2 className="before-after-title">{w('Before and after the Re-test')}</h2>
      <ul className="ba-grid" aria-label={summary}>
        {ROWS.map((row) => {
          const before = result.before[row.key];
          const after = result.after[row.key];
          return (
            <li className={`ba-item ${row.className}`} key={row.key}>
              <span className="ba-label">{w(row.label)}</span>
              <span className="ba-numbers" aria-hidden="true">
                <span>{before}</span>
                <span className="ba-arrow">{'\u2192'}</span>
                <b>{after}</b>
              </span>
            </li>
          );
        })}
      </ul>
      {!changedAnything(result) ? (
        <p className="muted small">{w('The Re-test found the same result as before.')}</p>
      ) : null}
      {result.notRechecked > 0 ? (
        <p className="muted small">
          {uiLang === 'ur'
            ? `${result.notRechecked} tables Re-test mein check nahi hue aur yahan ginay nahi gaye.`
            : `${result.notRechecked} ${result.notRechecked === 1 ? 'table was' : 'tables were'} not checked in the Re-test and ${result.notRechecked === 1 ? 'is' : 'are'} not counted here.`}
        </p>
      ) : null}
      {result.newTables > 0 ? (
        <p className="muted small">
          {uiLang === 'ur'
            ? `Re-test mein ${result.newTables} naye tables mile. Un ka pehle ka nateeja nahi, isliye yahan ginay nahi gaye.`
            : `${result.newTables} new ${result.newTables === 1 ? 'table' : 'tables'} found in the Re-test ${result.newTables === 1 ? 'has' : 'have'} no before, so ${result.newTables === 1 ? 'it is' : 'they are'} not counted here.`}
        </p>
      ) : null}
    </section>
  );
}
