'use client';

import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

export function CleanupWarning({ note }: { note?: string }) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  return (
    <div className="warning-card" role="alert">
      <div className="warning-icon" aria-hidden="true">
        !
      </div>
      <div>
        <strong>{w('Cleanup did not finish.')}</strong>
        <p>
          {note ??
            w('Some temporary test users or canary rows may still be in your test project. Check Supabase Auth and your tables.')}
        </p>
      </div>
    </div>
  );
}
