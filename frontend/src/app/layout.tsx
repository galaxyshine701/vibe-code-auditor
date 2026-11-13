import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { AppProvider } from '@/components/app-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vibe Code Auditor',
  description:
    'Test what another user can read or change in a Supabase test project.',
};

const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=(q==='light'||q==='dark')?q:localStorage.getItem('vca-theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
        <AppProvider>
          <AppHeader />
          <main className="site-main">{children}</main>
          <footer className="site-footer">
            <div className="shell footer-inner">
              <p>
                Vibe Code Auditor checks test projects only. Results are
                evidence from the checks that ran, not a guarantee.
              </p>
              <p className="footer-note">Evidence, not a guarantee.</p>
            </div>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
