'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MouseEvent } from 'react';
import { PROJECT_NAME, PROJECT_TAGLINE } from '@/lib/brand';
import { USE_MOCK } from '@/lib/config';
import { ThemeToggle } from './theme-toggle';

export function AppHeader() {
  const pathname = usePathname();

  function replayHero(event: MouseEvent<HTMLAnchorElement>) {
    if (pathname === '/') {
      event.preventDefault();
      window.dispatchEvent(new Event('vca:replay-hero'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link
          href="/"
          className="brand"
          aria-label={`${PROJECT_NAME} home`}
          onClick={replayHero}
        >
          <span className="brand-dot" aria-hidden="true" />
          <span className="brand-text">
            <span className="brand-name">{PROJECT_NAME}</span>
            <span className="brand-sub">{PROJECT_TAGLINE}</span>
          </span>
        </Link>
        <div className="header-actions">
          {USE_MOCK ? <span className="pill pill-muted">Sample data</span> : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
