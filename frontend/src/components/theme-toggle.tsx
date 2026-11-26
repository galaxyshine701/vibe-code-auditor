'use client';

import { useEffect, useState } from 'react';
import { THEME, pickText } from '@/lib/hero-copy';
import { useLang } from '@/lib/use-lang';

type Theme = 'dark' | 'light';
const CHANGE = 'vca:theme';

// The colour of the browser bar, the same as the page (--bg of each theme).
const BAR_COLOR: Record<Theme, string> = { dark: '#0f1114', light: '#efefec' };

function setBarColor(theme: Theme) {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', BAR_COLOR[theme]);
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M13.2 10.2A5.6 5.6 0 0 1 5.8 2.8a5.6 5.6 0 1 0 7.4 7.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [lang] = useLang();

  useEffect(() => {
    const read = () => {
      const current = document.documentElement.dataset.theme;
      const known: Theme = current === 'light' ? 'light' : 'dark';
      setTheme(known);
      setBarColor(known);
    };
    read();
    // there is a second button in the footer: both show the same theme
    window.addEventListener(CHANGE, read);
    return () => window.removeEventListener(CHANGE, read);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    setBarColor(next);
    window.dispatchEvent(new Event(CHANGE));
    try {
      localStorage.setItem('vca-theme', next);
    } catch {
      // Theme still changes for this visit.
    }
  }

  // the button names the theme a click would give
  const other = THEME[theme === 'dark' ? 'light' : 'dark'];

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={pickText(other.action, lang)}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      <span>{pickText(other.word, lang)}</span>
    </button>
  );
}
