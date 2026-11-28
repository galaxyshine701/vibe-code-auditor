import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The reveal on scroll (round 4): a card comes up 28px and fades in, once. The
// frontend has no test runner of its own, so its files are read by path; how it
// runs in a browser is checked by hand.
const SRC = join(__dirname, '..', '..', '..', 'frontend', 'src');
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');
const reveal = (await import(
  /* @vite-ignore */ pathToFileURL(join(SRC, 'lib', 'reveal.ts')).href
)) as typeof import('../../../frontend/src/lib/reveal');
const css = read('app', 'glass.css');
const code = read('lib', 'reveal.ts');

describe('the numbers', () => {
  it('threshold 0.15, a little inside the bottom, 650ms', () => {
    expect(reveal.REVEAL.threshold).toBe(0.15);
    expect(reveal.REVEAL.rootMargin).toBe('0px 0px -8% 0px');
    expect(reveal.REVEAL.durationMs).toBe(650);
    expect(css).toMatch(/animation: revealUp 650ms ease-out var\(--reveal-delay, 0ms\) both;/);
  });

  it('a stagger of at most 90ms a card and 450ms in all', () => {
    expect([0, 1, 2, 5, 6, 40].map(reveal.delayOf)).toEqual([0, 90, 180, 450, 450, 450]);
  });
});

describe('the movement', () => {
  it('from 28px below and unseen, to its place; opacity and transform only', () => {
    const body = /@keyframes revealUp \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(body).toMatch(/from \{\s*opacity: 0;\s*transform: translateY\(28px\);/);
    expect(body).toMatch(/to \{\s*opacity: 1;\s*transform: translateY\(0\);/);
    for (const prop of [...body.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1])) {
      expect(['opacity', 'transform']).toContain(prop);
    }
  });

  it('will-change is there only while it runs, and a finished card keeps no style', () => {
    expect(css.match(/will-change/g)).toHaveLength(1);
    expect(css).toMatch(/\[data-reveal-state="run"\] \{[^}]*will-change: opacity, transform;/);
    expect(css).not.toMatch(/\[data-reveal-state="done"\]/);
    expect(code).toContain("removeProperty('--reveal-delay')");
  });

  it('runs once: a card that has started is not watched again', () => {
    expect(code).toContain('watch.unobserve(node)');
    expect(code).toContain(':not([data-reveal-state])');
  });

  it('what moves is the wrapper, never the glass with its blur', () => {
    const files = [
      ['app', 'page.tsx'],
      ['app', 'audits', '[id]', 'page.tsx'],
      ['app', 'audits', '[id]', 'report', 'page.tsx'],
      ['app', 'audits', '[id]', 'certificate', 'page.tsx'],
      ['components', 'what-it-checks.tsx'],
      ['components', 'how-it-works.tsx'],
      ['components', 'word-meanings.tsx'],
      ['components', 'section-head.tsx'],
      ['components', 'access-gate.tsx'],
    ];
    for (const file of files) {
      const text = read(...file);
      expect(text, file.join('/')).toMatch(/<Reveal\b|data-reveal="card"/);
      expect(text, file.join('/')).not.toMatch(/data-reveal[^>]*className="[^"]*\bglass\b/);
    }
  });
});

describe('the fallbacks', () => {
  const layout = read('app', 'layout.tsx');

  it('nothing is hidden without the page code: only a state it sets hides', () => {
    const hidden = [...css.matchAll(/([^{}]*)\{[^{}]*opacity: 0;\s*transform: translateY\(28px\);/g)][0][1];
    expect(hidden).toContain('[data-reveal-state="wait"]');
    expect(css).not.toContain('data-reveal-boot');
    expect(css).not.toMatch(/^(\.reveal|\[data-reveal\]) \{[^}]*opacity: 0/m);
    expect(layout).not.toContain('REVEAL');
  });

  it('only what is wholly below the screen waits', () => {
    expect([0, 799, 800, 2000, -300].map((top) => reveal.isBelow(top, 800))).toEqual([
      false, false, true, true, false,
    ]);
    expect(code).toContain('if (!below[i])');
  });

  it('an observer that never answers keeps nothing hidden: all is shown after 4 seconds', () => {
    expect(reveal.REVEAL.fallbackMs).toBe(4000);
    expect(code).toContain('if (answered) return;');
  });

  it('reduced motion: no animation, everything in place', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\[data-reveal\] \{\s*opacity: 1 !important;\s*transform: none !important;\s*animation: none !important;/);
    expect(read('components', 'reveal.tsx')).toContain('prefers-reduced-motion: reduce');
  });

  it('shows what the keyboard reaches', () => {
    expect(code).toContain('focusin');
  });
});
