'use client';

import { useEffect } from 'react';

// "Fix confirmed" (R66). The canary metaphor: first the alarm (a red ring that
// pulses and the canary dot flaring), then calm (a green ring with a filled
// green dot, the canary dot at rest). It is shown only for a finding a Re-test moved from
// LEAKED to BLOCKED. The animation runs once, for a finding that became fixed
// in this page session by the user's own Re-test; a page that is opened or
// refreshed shows the calm state at once. The words are always there, so the
// colours are never the only message.
export function FixSeal({
  animate,
  onDone,
}: {
  animate: boolean;
  /** Called when the animation has ended (or at once when the motion is reduced). */
  onDone: () => void;
}) {
  useEffect(() => {
    if (!animate) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(onDone, reduce ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [animate, onDone]);

  return (
    <div className={`fix-seal ${animate ? 'is-animating' : ''}`}>
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
        <circle className="seal-ring" cx="16" cy="16" r="12.5" />
        <circle className="seal-core" cx="16" cy="16" r="5.2" />
        <circle className="seal-canary" cx="26" cy="6.5" r="3" />
      </svg>
      <div className="fix-seal-text">
        <strong>Fix confirmed</strong>
        <span className="muted small">Re-test: LEAKED, now BLOCKED</span>
      </div>
    </div>
  );
}
