import Link from 'next/link';
import { USE_MOCK } from '@/lib/config';

export function AppHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="Vibe Code Auditor home">
          <span className="brand-mark" aria-hidden="true">
            VA
          </span>
          <span className="brand-text">
            <span className="brand-name">Vibe Code Auditor</span>
            <span className="brand-sub">Supabase access checks</span>
          </span>
        </Link>
        <div className="header-badges">
          {USE_MOCK ? (
            <span className="pill pill-mock">Demo data mode</span>
          ) : null}
          <span className="pill pill-outline">Test projects only</span>
        </div>
      </div>
    </header>
  );
}
