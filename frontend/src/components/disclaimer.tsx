import type { ReactNode } from 'react';
import { DISCLAIMER } from '@/lib/config';

export function Disclaimer({ children }: { children?: ReactNode }) {
  return (
    <div className="disclaimer-card">
      <span className="disclaimer-label">What these checks cover</span>
      <p>{DISCLAIMER}</p>
      {children}
    </div>
  );
}
