import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The checkpoint lane of the hero's example run (frontend/src/components/
// checkpoint-lane.tsx): a rail, a checkpoint per row, a bar at the gate, and a
// dot that goes down with the beam. Plain SVG and CSS. There is no real browser
// in this suite, so the rules of the CSS are checked as text (reduced motion,
// 375 px) and the markup is rendered for real.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const read = (...parts: string[]) =>
  readFileSync(join(FRONTEND, 'src', ...parts), 'utf8');
const requireFrontend = createRequire(join(FRONTEND, 'package.json'));
const React = requireFrontend('react') as typeof import('react');
const { renderToStaticMarkup } = requireFrontend(
  'react-dom/server',
) as typeof import('react-dom/server');

const lane = (await import(
  /* @vite-ignore */ pathToFileURL(
    join(FRONTEND, 'src', 'components', 'checkpoint-lane.tsx'),
  ).href
)) as {
  LANE_SHAPE: Record<string, string>;
  LaneNode: (p: { tone: 'ok' | 'leak' | 'warn' }) => unknown;
  GateBar: () => unknown;
  LaneDot: (p: { delay: string; duration: string }) => unknown;
};
const html = (element: unknown) =>
  renderToStaticMarkup(element as React.ReactElement);

const css = read('app', 'hero.css');
const card = read('components', 'hero-card.tsx');

describe('the shapes of the checkpoints', () => {
  it('a bar = BLOCKED (stopped), an open ring = LEAKED (got through), a dashed ring = INCONCLUSIVE', () => {
    expect(lane.LANE_SHAPE).toEqual({ ok: 'bar', leak: 'open', warn: 'dashed' });
    const ok = html(React.createElement(lane.LaneNode as never, { tone: 'ok' }));
    const leak = html(React.createElement(lane.LaneNode as never, { tone: 'leak' }));
    const warn = html(React.createElement(lane.LaneNode as never, { tone: 'warn' }));
    expect(ok).toContain('hero-node-bar');
    expect(ok).toContain('<path');
    expect(leak).toContain('hero-node-open');
    expect(leak).toContain('<path');
    expect(warn).toContain('hero-node-dashed');
    expect(warn).toContain('<circle');
  });

  it('every checkpoint is only drawn (aria-hidden): the verdict word is in the row, never only in the shape', () => {
    for (const tone of ['ok', 'leak', 'warn']) {
      const out = html(React.createElement(lane.LaneNode as never, { tone }));
      expect(out).toContain('aria-hidden="true"');
      expect(out).not.toMatch(/<text|<title/);
    }
    expect(html(React.createElement(lane.GateBar as never))).toContain('hero-node-gate');
    // each row ends with a verdict word (a badge or the "2 missing" chip)
    expect(card).toContain('<VerdictBadge verdict="LEAKED"');
    expect(card).toContain('<VerdictBadge verdict="INCONCLUSIVE"');
    expect(card).toContain('hero-chip-warn');
  });

  it('shapes are told apart without colour: a bar, an open arc and a dashed ring', () => {
    const shapes = new Set(Object.values(lane.LANE_SHAPE));
    expect(shapes.size).toBe(3);
    expect(css).toMatch(/\.hero-node-dashed circle \{\s*stroke-dasharray/);
    expect(css).toMatch(/\.hero-node-bar \{\s*stroke-width: 4\.4/);
  });
});

describe('the lane in the card', () => {
  it('every row has a checkpoint, the gate has a bar, and the dot goes down with the beam', () => {
    expect(card).toContain("from './checkpoint-lane'");
    expect(card).toContain('<LaneNode tone={tone} />');
    expect(card).toContain('<GateBar />');
    expect(card).toContain('<LaneDot delay={`${BEAM_START}s`} duration={`${BEAM_DUR}s`} />');
    expect(card.match(/<Row\b/g)).toHaveLength(4);
  });

  it('the checkpoint takes its colour when the beam has passed its row (--at), like the bar at the left of the row', () => {
    expect(css).toMatch(/\.hero-node \{[^}]*animation: heroNode 0\.3s ease-out var\(--at, 0s\) both/);
    expect(css).toMatch(/@keyframes heroNode \{\s*to \{\s*stroke: var\(--tone\)/);
  });

  it('the dot goes top to bottom once, along the rail, in the time of the beam', () => {
    expect(css).toMatch(/\.hero-lane-dot \{[^}]*animation: heroLaneDot var\(--dot-dur[^}]*var\(--dot-delay[^}]*both/);
    expect(css).toMatch(/@keyframes heroLaneDot \{[\s\S]*?top: calc\(100% - 8px\)/);
    expect(css).not.toMatch(/animation:[^;]*infinite/);
    expect(css).toMatch(/\.hero-rows::before \{[^}]*width: 2px/);
  });

  it('waits for the intro like the rest of the card (its elements are inside .hero-card)', () => {
    expect(css).toMatch(/html\[data-intro="pending"\] \.hero-card \*/);
    expect(card).toContain('<section className="hero-card"');
  });
});

describe('the card, rendered for real', () => {
  it('says "Example result, not a real audit" in both languages, and has 4 checkpoints, 1 gate bar and 1 dot', async () => {
    const { HeroCard } = (await import(
      /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'components', 'hero-card.tsx')).href
    )) as { HeroCard: (p: { lang: 'en' | 'ur' }) => unknown };
    const en = html(React.createElement(HeroCard as never, { lang: 'en' }));
    const ur = html(React.createElement(HeroCard as never, { lang: 'ur' }));
    expect(en).toContain('Example result, not a real audit');
    expect(ur).toContain('Misaal ka nateeja, asli audit nahi');
    for (const out of [en, ur]) {
      expect(out.match(/class="hero-node hero-node-(?:bar|open|dashed)"/g)).toHaveLength(4);
      expect(out.match(/hero-node-gate/g)).toHaveLength(1);
      expect(out.match(/class="hero-lane-dot"/g)).toHaveLength(1);
      expect(out.match(/class="hero-row /g)).toHaveLength(4);
      // the verdict words are in the page, and the masked key only
      for (const word of ['LEAKED', 'INCONCLUSIVE']) expect(out).toContain(word);
      expect(out).toContain('sb_secret_••••');
    }
    expect(en).toContain('Secret key in a file');
    expect(ur).toContain('File mein secret key');
  });
});

describe('reduced motion and a phone', () => {
  it('with reduced motion the dot is not shown and the checkpoints are in their final colour', () => {
    const block = css.slice(
      css.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(block).toMatch(/\.hero-lane-dot \{\s*display: none/);
    expect(block).toMatch(/\.hero-node \{\s*animation: none;\s*stroke: var\(--tone\)/);
  });

  it('at 480 px and narrower (375 px included) it is the final state, with a narrow lane and no overflow', () => {
    const block = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(block).toMatch(/\.hero-lane-dot \{\s*display: none/);
    expect(block).toMatch(/\.hero-node \{\s*animation: none;\s*stroke: var\(--tone\)/);
    expect(block).toMatch(/\.hero-rows \{\s*--lane-pad: 12px/);
    // the column of the checkpoint is a fixed 1.5rem (24px): the text column can shrink
    expect(css).toMatch(/grid-template-columns: 1\.5rem minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/\.hero-rows \{[^}]*overflow: hidden/);
  });
});

describe('plain: no library, no new colour, no lock, no tick', () => {
  it('the frontend has the same three dependencies as before', () => {
    const pkg = JSON.parse(
      readFileSync(join(FRONTEND, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['next', 'react', 'react-dom']);
  });

  it('checkpoint-lane.tsx imports only a type from react, and has no hard-coded colour', () => {
    const source = read('components', 'checkpoint-lane.tsx');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['react']);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('no lock and no tick: the shapes are a line, an arc and a circle', () => {
    const source = read('components', 'checkpoint-lane.tsx');
    expect(source.replace(/\/\/[^\n]*/g, '')).not.toMatch(
      /lock|shackle|check ?mark|tick/i,
    );
    expect(source).toContain('M4 12H20');
  });

  it('the words of the lane never claim safety', () => {
    expect(read('components', 'checkpoint-lane.tsx')).not.toMatch(
      /\b(safe|safely|secure|secured|certified|certificate|guarantee[ds]?)\b/i,
    );
  });
});
