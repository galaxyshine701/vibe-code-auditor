'use client';

import type { ReactNode } from 'react';
import { DISCLAIMER } from '@/lib/config';
import { COVERAGE_UR } from '@/lib/coverage';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

/**
 * `statement` is the sentence of R39 about what the checks cover. The default is
 * the one of the table checks; an audit with the stages passes its own (the
 * client report's disclaimer is shown as a child), or "" to show none.
 */
export function Disclaimer({
  children,
  statement,
}: {
  children?: ReactNode;
  statement?: string;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  return (
    <div className="disclaimer-card">
      <span className="disclaimer-label">{w('What these checks cover')}</span>
      {statement !== '' ? <p>{statement ?? (uiLang === 'ur' ? COVERAGE_UR.statement : DISCLAIMER)}</p> : null}
      {children}
    </div>
  );
}
