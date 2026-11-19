'use client';

import type { Lang } from '@/lib/check-labels';

// The English / Roman Urdu switch (R42). Same look as the one of the Report.
export function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (lang: Lang) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Language">
      <button
        type="button"
        className={lang === 'en' ? 'segment active' : 'segment'}
        aria-pressed={lang === 'en'}
        onClick={() => onChange('en')}
      >
        English
      </button>
      <button
        type="button"
        className={lang === 'ur' ? 'segment active' : 'segment'}
        aria-pressed={lang === 'ur'}
        onClick={() => onChange('ur')}
      >
        Roman Urdu
      </button>
    </div>
  );
}
