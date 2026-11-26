'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import type { Lang } from '@/lib/check-labels';
import { SECTIONS, STEPS, pickText } from '@/lib/hero-copy';
import { SectionHead } from './section-head';

// "How it works": three steps in a row, joined by a line (upright on a phone),
// each with a small picture made of plain shapes. The pictures have no words, no
// lock, no tick and no shield. The steps rise once when they come into view
// (transform and opacity only); with no script, or with reduced motion, they are
// simply there.
const VISUALS = {
  // a field with a link in it, and a button
  paste: (
    <>
      <rect className="v-box" x="8" y="16" width="184" height="30" rx="8" />
      <circle className="v-mark" cx="22" cy="31" r="4" />
      <circle className="v-mark" cx="28" cy="31" r="4" />
      <rect className="v-line" x="40" y="28" width="104" height="6" rx="3" />
      <path className="v-caret" d="M150 23v16" />
      <rect className="v-button" x="8" y="56" width="76" height="18" rx="6" />
    </>
  ),
  // four rows, each with a dot
  run: (
    <>
      {[0, 1, 2, 3].map((row) => (
        <g key={row} transform={`translate(0 ${row * 19})`}>
          <rect className="v-box" x="8" y="6" width="184" height="15" rx="5" />
          <circle className={`v-dot v-dot-${row}`} cx="20" cy="13.5" r="3.5" />
          <rect className="v-line" x="32" y="11" width={[96, 124, 80, 108][row]} height="5" rx="2.5" />
        </g>
      ))}
    </>
  ),
  // verdict pills and a piece of a fix prompt
  result: (
    <>
      <rect className="v-pill v-pill-leak" x="8" y="8" width="56" height="17" rx="8.5" />
      <rect className="v-pill v-pill-grey" x="72" y="8" width="70" height="17" rx="8.5" />
      <rect className="v-pill v-pill-ok" x="150" y="8" width="42" height="17" rx="8.5" />
      <rect className="v-box" x="8" y="33" width="184" height="46" rx="8" />
      <rect className="v-line" x="20" y="43" width="120" height="5" rx="2.5" />
      <rect className="v-line" x="20" y="54" width="152" height="5" rx="2.5" />
      <rect className="v-line" x="20" y="65" width="88" height="5" rx="2.5" />
    </>
  ),
} as const;

export function HowItWorks({ lang }: { lang: Lang }) {
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const node = list.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // already on the screen: leave it as it is
    if (node.getBoundingClientRect().top < window.innerHeight) return;
    node.dataset.rise = 'waiting';
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      node.dataset.rise = 'up';
      watch.disconnect();
    });
    watch.observe(node);
    return () => {
      watch.disconnect();
      delete node.dataset.rise;
    };
  }, []);

  return (
    <section className="home-section how" aria-labelledby="how-title">
      <SectionHead id="how-title" head={SECTIONS.how} lang={lang} />
      <ol className="how-steps glass-wrap" ref={list}>
        {STEPS.map((step, index) => (
          <li className="how-step glass" key={step.visual} style={{ '--i': index } as CSSProperties}>
            <svg className="how-visual" viewBox="0 0 200 84" aria-hidden="true" focusable="false">
              {VISUALS[step.visual]}
            </svg>
            <span className="how-number" aria-hidden="true">
              {index + 1}
            </span>
            <h3>{pickText(step.title, lang)}</h3>
            <p>{pickText(step.body, lang)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
