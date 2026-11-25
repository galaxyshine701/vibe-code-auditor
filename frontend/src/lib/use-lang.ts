'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Lang } from './check-labels';

// The English / Roman Urdu choice of R42, kept for the tab, so the Progress and
// the Report screen agree. Storage can be blocked: then it is English and the
// choice lasts for the page only.
const KEY = 'vca-lang';
// tells every other user of this hook (the header's access bar) about a change
const CHANGE = 'vca:lang';

export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const kept = window.sessionStorage.getItem(KEY);
      if (kept === 'en' || kept === 'ur') setLangState(kept);
    } catch {
      // blocked storage: stay in English
    }
    const follow = (event: Event) => {
      const next = (event as CustomEvent).detail;
      if (next === 'en' || next === 'ur') setLangState(next);
    };
    window.addEventListener(CHANGE, follow);
    return () => window.removeEventListener(CHANGE, follow);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.sessionStorage.setItem(KEY, next);
    } catch {
      // not kept: fine
    }
    window.dispatchEvent(new CustomEvent(CHANGE, { detail: next }));
  }, []);

  return [lang, setLang];
}
