'use client';

import { useLayoutEffect, type ReactNode } from 'react';
import { startReveal } from '@/lib/reveal';

// The outer wrapper of a card that rises into view (lib/reveal.ts). It is the
// layer that moves; the card inside it, with its blur, stays still. With nothing
// in it, it takes no room.
export function Reveal({
  children,
  head = false,
}: {
  children: ReactNode;
  /** the heading of a section: it rises with the first card of its group */
  head?: boolean;
}) {
  return (
    <div className="reveal" data-reveal={head ? 'head' : 'card'}>
      {children}
    </div>
  );
}

/** Once, in the layout: watches every wrapper of every page. */
export function RevealController() {
  useLayoutEffect(() => {
    const still =
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return still ? undefined : startReveal(document.body);
  }, []);
  return null;
}
