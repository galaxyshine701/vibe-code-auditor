import type { ReactNode } from 'react';
import { DISCLAIMER } from '@/lib/config';

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
  return (
    <div className="disclaimer-card">
      <span className="disclaimer-label">What these checks cover</span>
      {statement !== '' ? <p>{statement ?? DISCLAIMER}</p> : null}
      {children}
    </div>
  );
}
