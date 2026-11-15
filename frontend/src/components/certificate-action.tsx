'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { CertificateLock } from '@/lib/outcome';

function Padlock({ open }: { open: boolean }) {
  return (
    <svg
      className={`padlock ${open ? 'is-open' : ''}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <rect x="3" y="7.2" width="10" height="6.8" rx="1.6" className="padlock-body" />
      <path
        className="padlock-shackle"
        d="M5.4 7.2V5.2a2.6 2.6 0 0 1 5.2 0v2"
        fill="none"
      />
    </svg>
  );
}

// "Open certificate view" (R68). Locked until the audit is eligible, with the
// reason always written next to it (not in a tooltip). The lock opens with a
// short animation, once, only when the user's own Re-test made it eligible.
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
          <Padlock open />
          Open certificate view
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
        <Padlock open={false} />
        Open certificate view
      </button>
      <p className="muted small cert-reason" id="cert-reason">
        {lock.reason}
      </p>
    </div>
  );
}
