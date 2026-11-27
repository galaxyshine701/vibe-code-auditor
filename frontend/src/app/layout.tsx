import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { AppProvider } from '@/components/app-provider';
import { RevealController } from '@/components/reveal';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { SiteFooter } from '@/components/site-footer';
import { PROJECT_DESCRIPTION, PROJECT_NAME, PROJECT_TITLE } from '@/lib/brand';
import { INTRO_BOOT_SCRIPT } from '@/lib/intro';
import './globals.css';
import './intro.css';
import './stage.css';
import './report.css';
import './hero.css';
import './glass.css';

// The three fonts are fetched at build time and served by this site, each with
// "font-display: swap": the words are painted at once and take the font when it
// is there. The mono font is only for code, so it is not asked for in advance.
const displayFont = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-bricolage',
});
const bodyFont = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});
const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
  preload: false,
});

export const metadata: Metadata = {
  title: PROJECT_TITLE,
  description: PROJECT_DESCRIPTION,
  // text only: there is no picture
  openGraph: {
    title: PROJECT_TITLE,
    description: PROJECT_DESCRIPTION,
    type: 'website',
    siteName: PROJECT_NAME,
  },
};

// The first visit is dark, not decided by the system setting (R55). The
// choice of the toggle is kept in localStorage ("vca-theme"). This script is
// inline in the head, so the theme is set before the first paint.
export const viewport: Viewport = {
  themeColor: '#0f1114',
  width: 'device-width',
  initialScale: 1,
  // the page may use the whole screen of a phone; glass.css keeps the words
  // clear of its notch and home bar
  viewportFit: 'cover',
  colorScheme: 'dark',
};

const themeScript = `(function(){var t='dark';try{var q=new URLSearchParams(location.search).get('theme');var s=(q==='light'||q==='dark')?q:localStorage.getItem('vca-theme');if(s==='light'||s==='dark'){t=s;}}catch(e){}document.documentElement.dataset.theme=t;})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* decides before the first paint whether the intro runs (R70) */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
      </head>
      <body>
        <ServiceWorkerRegister />
        <AppProvider>
          <AppHeader />
          <main className="site-main">{children}</main>
          <SiteFooter />
          <RevealController />
        </AppProvider>
      </body>
    </html>
  );
}
