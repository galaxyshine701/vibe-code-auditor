import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { AppProvider } from '@/components/app-provider';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { INTRO_BOOT_SCRIPT } from '@/lib/intro';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vibe Code Auditor',
  description:
    'Find out what another user can read, change or delete in a Supabase project.',
};

// The first visit is dark, not decided by the system setting (R55). The
// choice of the toggle is kept in localStorage ("vca-theme"). This script is
// inline in the head, so the theme is set before the first paint.
export const viewport: Viewport = {
  themeColor: '#0f1114',
  colorScheme: 'dark',
};

const themeScript = `(function(){var t='dark';try{var q=new URLSearchParams(location.search).get('theme');var s=(q==='light'||q==='dark')?q:localStorage.getItem('vca-theme');if(s==='light'||s==='dark'){t=s;}}catch(e){}document.documentElement.dataset.theme=t;})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* decides before the first paint whether the intro runs (R70) */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ServiceWorkerRegister />
        <AppProvider>
          <AppHeader />
          <main className="site-main">{children}</main>
          <footer className="site-footer">
            <div className="shell footer-inner">
              <p>Vibe Code Auditor · Supabase access checks</p>
            </div>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
