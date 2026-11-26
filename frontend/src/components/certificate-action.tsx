'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { CertificateLock } from '@/lib/outcome';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

// A plain round mark in front of the button text: a dashed ring while the
// result view is not available yet, a solid ring with a filled dot when it is.
// Only a shape; the words next to it say the same thing.
function CertMark({ ready }: { ready: boolean }) {
  return (
    <svg
      className={`cert-mark ${ready ? 'is-ready' : ''}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <circle className="cert-mark-ring" cx="8" cy="8" r="6" />
      {ready ? <circle className="cert-mark-fill" cx="8" cy="8" r="3.2" /> : null}
    </svg>
  );
}

// "Open result view" (R68, R87: the screen is called Re-test result). Not
// available until the audit is eligible, with the reason always written next to
// it (not in a tooltip). The mark fills with a short animation, once, only when
// the user's own Re-test made it eligible.
export function CertificateAction({
  auditId,
  lock,
  playUnlock,
  onPlayed,
}: {
  auditId: string;
  lock: CertificateLock;
  playUnlock: boolean;
  onPlayed: () => void;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  useEffect(() => {
    if (!playUnlock) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(onPlayed, reduce ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [playUnlock, onPlayed]);

  if (lock.eligible) {
    return (
      <div className={`cert-action ${playUnlock ? 'is-unlocking' : ''}`}>
        <Link href={`/audits/${auditId}/certificate`} className="button button-ghost cert-button">
          <CertMark ready />
          {w('Open result view')}
        </Link>
      </div>
    );
  }

  return (
    <div className="cert-action">
      <button
        type="button"
        className="button button-ghost cert-button is-locked"
        aria-disabled="true"
        aria-describedby="cert-reason"
        onClick={(event) => event.preventDefault()}
      >
        <CertMark ready={false} />
        {w('Open result view')}
      </button>
      <p className="muted small cert-reason" id="cert-reason">
        {w(lock.reason)}
      </p>
    </div>
  );
}
