'use client';

import { ACCESS, pickText } from '@/lib/hero-copy';
import { useLang } from '@/lib/use-lang';
import { useApp } from './app-provider';
import { SecretInput } from './secret-input';

// The small access-code bar in the header of the home page. The code lives in
// the memory of the page only (app-provider): nothing is written to any
// storage. What is typed is a draft until the Start button uses it. Enter in
// this field submits the start form (form="start-box").
export function AccessBar() {
  const { accessCode, accessDraft, setAccessDraft, clearAccessCode } = useApp();
  const [lang] = useLang();

  return (
    <div className="access-bar" id="access-gate">
      {!accessCode ? (
        <label className="access-field">
          <span>{pickText(ACCESS.label, lang)}</span>
          <SecretInput
            id="access-code"
            form="start-box"
            value={accessDraft}
            onChange={(event) => setAccessDraft(event.target.value)}
            maxLength={4096}
            title={pickText(ACCESS.memory, lang)}
            aria-describedby="access-memory"
          />
          <small id="access-memory">{pickText(ACCESS.memory, lang)}</small>
        </label>
      ) : (
        <div className="memory-chip">
          <span className="memory-dot" aria-hidden="true" />
          <span>{pickText(ACCESS.held, lang)}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              clearAccessCode();
              setAccessDraft('');
            }}
          >
            {pickText(ACCESS.change, lang)}
          </button>
        </div>
      )}
    </div>
  );
}
