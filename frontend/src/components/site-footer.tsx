'use client';

import { usePathname } from 'next/navigation';
import { PROJECT_NAME } from '@/lib/brand';
import { FOOTER, REPLAY, pickText } from '@/lib/hero-copy';
import { useLang } from '@/lib/use-lang';
import { ThemeToggle } from './theme-toggle';

// The footer, inside the container: the name and one line at the left, the small
// links at the right. "Replay intro" is on the home page only; with reduced
// motion it is not shown (globals.css).
export function SiteFooter() {
  const pathname = usePathname();
  const [lang] = useLang();

  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <p>
          <strong>{PROJECT_NAME}</strong>: {pickText(FOOTER.line, lang)}
        </p>
        <nav className="footer-links" aria-label={pickText(FOOTER.links, lang)}>
          {pathname === '/' ? (
            <button
              type="button"
              className="text-button hero-replay"
              onClick={() => window.dispatchEvent(new Event('vca:replay-hero'))}
            >
              {pickText(REPLAY, lang)}
            </button>
          ) : null}
          <ThemeToggle />
        </nav>
      </div>
    </footer>
  );
}
