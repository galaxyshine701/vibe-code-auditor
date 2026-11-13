'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MouseEvent } from 'react';
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
          aria-label="Vibe Code Auditor home"
          onClick={replayHero}
        >
          <span className="brand-dot" aria-hidden="true" />
          <span className="brand-text">
            <span className="brand-name">Vibe Code Auditor</span>
            <span className="brand-sub">Supabase access checks</span>
          </span>
        </Link>
        <div className="header-actions">
          {USE_MOCK ? <span className="pill pill-muted"></span> : null}
          <span className="pill pill-outline">Test projects only</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
