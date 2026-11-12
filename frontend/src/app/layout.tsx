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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
              <p className="footer-note">No leak found by these checks.</p>
            </div>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
