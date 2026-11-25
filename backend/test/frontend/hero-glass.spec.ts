import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// A2: the hero is a dark stage with glass cards, and a scene above the rows of
// the example run. These tests read the CSS and the components (the frontend
// has no test runner of its own) and work out the contrast of the worst
// background a word can have.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const SRC = join(FRONTEND, 'src');
const requireFrontend = createRequire(join(FRONTEND, 'package.json'));
const React = requireFrontend('react') as typeof import('react');
const { renderToStaticMarkup } = requireFrontend(
  'react-dom/server',
) as typeof import('react-dom/server');
const href = (...parts: string[]) => pathToFileURL(join(SRC, ...parts)).href;
// (Windows checks files out with CRLF; the tests below are written for LF)
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const css = read('app', 'glass.css');

type Lang = 'en' | 'ur';
const copy = (await import(
  /* @vite-ignore */ href('lib', 'hero-copy.ts')
)) as typeof import('../../../frontend/src/lib/hero-copy');
const sceneModule = (await import(
  /* @vite-ignore */ href('components', 'hero-scene.tsx')
)) as { HeroScene: (p: { lang: Lang }) => unknown };
const cardModule = (await import(
  /* @vite-ignore */ href('components', 'hero-card.tsx')
)) as { HeroCard: (p: { lang: Lang }) => unknown };
const numeral = (await import(
  /* @vite-ignore */ href('components', 'dot-numeral.tsx')
)) as {
  DotNumeral: (p: { value: number }) => unknown;
  digitsOf: (v: number) => string[];
};

// ---- the tokens of the stage ----
const stageBlock = /\.hero-stage \{([^}]*)\}/.exec(css)![1];
const token = (name: string, block = stageBlock): string => {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`token --${name} not found`);
  return match[1].trim();
};

type Rgba = [number, number, number, number];
function color(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!rgba) throw new Error(`not a colour: ${value}`);
  const [r, g, b, a = '1'] = rgba[1].split(',').map((p) => p.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}
const over = (bg: Rgba, top: Rgba, scale = 1): Rgba => {
  const a = Math.min(1, top[3] * scale);
  return [
    bg[0] * (1 - a) + top[0] * a,
    bg[1] * (1 - a) + top[1] * a,
    bg[2] * (1 - a) + top[2] * a,
    1,
  ];
};
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (c: Rgba) =>
  0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const fallbackScrim = /@supports not[^{]*\{[^{]*\.hero-stage \{[^}]*--glass-scrim:\s*([^;]+);/.exec(css)![1].trim();
const base = color(token('stage-base'));
const blobs = ['blob-amber', 'blob-green', 'blob-violet'].map((n) =>
  color(token(n)),
);

/**
 * The worst glass a word can sit on: the blobs behind it at the peak of one
 * blob (and the tail, half as strong, of another), 15 % stronger for the
 * saturation of the glass, then the dark scrim, the light of the glass and the
 * light sweep. Worked out for each blob as the strongest one; the lowest
 * contrast is kept.
 */
function glassBackgrounds(scrimToken: string) {
  const scrim = color(scrimToken);
  const hi = color(token('glass-hi'));
  const sweep = color(token('sweep'));
  const rowsScrim = color(token('rows-scrim'));
  return blobs.map((peak, i) => {
    const tail = blobs[(i + 1) % blobs.length];
    const behind = over(over(base, tail, 0.5), peak, 1.15);
    const glass = over(over(over(behind, scrim), hi), sweep);
    return { glass, rows: over(glass, rowsScrim) };
  });
}

describe('text contrast (AA) on the stage and on the glass', () => {
  const words = ['ink', 'ink-soft', 'muted', 'muted-2'].map((n) => ({
    n,
    c: color(token(n)),
  }));

  it('the words on the dark base (headline, lede, chips) are at least 4.5:1', () => {
    for (const { n, c } of words) {
      expect(ratio(c, base), n).toBeGreaterThanOrEqual(4.5);
    }
  });

  for (const [label, scrimToken] of [
    ['the glass', token('glass-scrim')],
    ['the glass without backdrop-filter (more solid)', fallbackScrim],
  ] as const) {
    it(`the words on ${label}, at its worst, are at least 4.5:1`, () => {
      for (const { glass } of glassBackgrounds(scrimToken)) {
        for (const { n, c } of words) {
          expect(ratio(c, glass), n).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`the verdict colours (words and the dots of the numerals) on the rows and tiles of ${label} are at least 4.5:1, with their soft tint`, () => {
      const tints: Record<string, string> = {
        leak: 'leak-soft',
        ok: 'ok-soft',
        canary: 'canary-soft',
      };
      for (const { rows } of glassBackgrounds(scrimToken)) {
        for (const [name, tint] of Object.entries(tints)) {
          const text = color(token(name));
          expect(ratio(text, rows), name).toBeGreaterThanOrEqual(4.5);
          expect(ratio(text, over(rows, color(token(tint)))), `${name} on its tint`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('the fallback is more solid than the glass, never lighter', () => {
    const fallback = color(fallbackScrim);
    expect(fallback[3]).toBeGreaterThan(color(token('glass-scrim'))[3]);
  });
});

describe('the stage and the glass', () => {
  it('has the dark base and the three blobs, with the colours that were asked for', () => {
    expect(token('stage-base')).toBe('#070b17');
    expect(token('blob-amber')).toBe('rgba(246, 201, 69, 0.34)');
    expect(token('blob-green')).toBe('rgba(63, 178, 127, 0.3)');
    expect(token('blob-violet')).toBe('rgba(122, 98, 216, 0.26)');
    expect(read('app', 'page.tsx')).toContain('className="hero hero-stage"');
  });

  it('the blobs sit behind the glass cards only, never on the stage itself (so no word is under a blob)', () => {
    expect(stageBlock).not.toMatch(/radial-gradient/);
    const wrapBlob = /\.hero-card-wrap::before \{([^}]*)\}/.exec(css)![1];
    const startBlob = /\.start-wrap::before \{([^}]*)\}/.exec(css)![1];
    for (const rule of [wrapBlob, startBlob]) {
      expect(rule).toContain('z-index: -1');
      expect(rule).toMatch(/radial-gradient/);
      expect(rule).not.toMatch(/\bfilter:/);
    }
    // the page wraps the main box, so a blob can sit behind it
    expect(read('app', 'page.tsx')).toContain('className="start-wrap"');
  });

  it('the glass is the gradient, the blur, the edge and the top light that were asked for', () => {
    expect(token('glass-hi')).toBe('rgba(255, 255, 255, 0.16)');
    expect(token('glass-lo')).toBe('rgba(255, 255, 255, 0.04)');
    expect(token('glass-blur')).toBe('blur(18px) saturate(150%)');
    expect(token('glass-edge')).toBe('rgba(255, 255, 255, 0.2)');
    const glass = /\.hero-card,\s*\.start-box \{([^}]*)\}/.exec(css)![1];
    expect(glass).toContain('linear-gradient(150deg, var(--glass-hi), var(--glass-lo))');
    expect(glass).toContain('-webkit-backdrop-filter: var(--glass-blur)');
    expect(glass).toContain('backdrop-filter: var(--glass-blur)');
    expect(glass).toContain('inset 0 1px 0 var(--glass-top)');
    expect(glass).toMatch(/border-radius: 2[0-4]px/);
  });

  it('on a phone the blur is lighter and there is no light sweep', () => {
    const phone = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)![1];
    const blur = (value: string) => Number(/blur\((\d+)px\)/.exec(value)![1]);
    expect(blur(/--glass-blur:\s*([^;]+);/.exec(phone)![1])).toBeLessThan(
      blur(token('glass-blur')),
    );
    expect(phone).toMatch(/\.hero-card::after \{\s*display: none;/);
  });

  it('there is a plain translucent card when backdrop-filter is missing', () => {
    expect(css).toMatch(
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/,
    );
  });

  it('there is one light sweep, once, on the main card', () => {
    const rule = /\.hero-card::after \{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/animation: heroSweep [\d.]+s [^;]*\b1 both;/);
    expect(css.match(/::after \{[^}]*animation: heroSweep/g)).toHaveLength(1);
  });

  it('with reduced motion nothing moves: no sweep and no scene animation', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(reduced).toMatch(/\.hero-card::after \{\s*display: none;/);
    for (const part of ['canary', 'glow', 'stranger', 'barrier-bar', 'key']) {
      expect(reduced).toContain(`.scene-${part}`);
    }
    expect(reduced).toContain('animation: none');
  });

  it('on a phone (480 px) the scene is its last frame', () => {
    const phone = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)![1];
    for (const part of ['canary', 'glow', 'stranger', 'barrier-bar', 'key']) {
      expect(phone).toContain(`.scene-${part}`);
    }
    expect(phone).toContain('animation: none');
  });

  it('every animation of the scene and the sweep moves only transform and opacity (nothing that makes the page lay out again)', () => {
    const names = [
      ...new Set(
        [...css.matchAll(/animation: (\w+) /g)].map((m) => m[1]),
      ),
    ];
    expect(names.sort()).toEqual(
      ['heroSweep', 'sceneDown', 'sceneFade', 'sceneKey', 'sceneLand', 'sceneWalk'].sort(),
    );
    for (const name of names) {
      const body = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`).exec(css)![1];
      const props = [...body.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]);
      for (const prop of props) {
        expect(['opacity', 'transform'], `${name}: ${prop}`).toContain(prop);
      }
    }
  });

  it('the glow is only on the canary, the window of the key, and the three verdict tiles (no blur filter on the scene)', () => {
    expect(css).toMatch(/\.scene-glow-canary \{\s*fill: url\(#scene-glow-canary\)/);
    expect(css).toMatch(/\.scene-glow-key \{\s*fill: url\(#scene-glow-key\)/);
    expect(css).toMatch(/\.hero-tile \{[^}]*box-shadow: 0 0 26px -10px var\(--tone-glow\)/);
    expect(css).toMatch(/\.dot-numeral \{[^}]*filter: drop-shadow\(0 0 4px var\(--tone-glow\)\)/);
    // a filter only on the numerals; no blur filter anywhere
    // (a plain `filter:`, not the `backdrop-filter:` of the glass)
    expect(css.match(/(?<![-\w])filter:/g)).toHaveLength(1);
    expect(css).not.toMatch(/(?<![-\w])filter:\s*blur/);
  });
});

describe('the scene', () => {
  const scene = read('components', 'hero-scene.tsx');
  const html = (lang: Lang) =>
    renderToStaticMarkup(
      React.createElement(sceneModule.HeroScene as never, { lang }),
    );

  it('draws a canary on a post, a stranger at a striped barrier, and an app with a key in a window', () => {
    for (const part of [
      'scene-canary',
      'scene-post',
      'scene-stranger',
      'scene-barrier-bar',
      'scene-stripes',
      'scene-app',
      'scene-window',
      'scene-key',
    ]) {
      expect(scene).toContain(part);
    }
    // an inline SVG: no image file, no library
    expect(scene).not.toMatch(/<img|from '[^'.@][^']*'/);
  });

  it('says BLOCKED under the barrier and LEAKED under the key, in words, in both languages', () => {
    for (const lang of ['en', 'ur'] as const) {
      const out = html(lang);
      expect(out).toContain('BLOCKED');
      expect(out).toContain('LEAKED');
      expect(out).toContain('<figcaption');
      // the picture itself is hidden from a reader of the screen; the captions say it
      expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    }
    expect(copy.SCENE.barrier.verdict).toBe('BLOCKED');
    expect(copy.SCENE.key.verdict).toBe('LEAKED');
    expect(copy.SCENE.label.ur).toContain('Misaal');
  });

  it('is light: one SVG, a gradient for the glow (no filter), few shapes', () => {
    const out = html('en');
    expect(out.match(/<svg/g)).toHaveLength(1);
    expect(out).not.toContain('<filter');
    expect(out.match(/<(circle|rect|path|ellipse)\b/g)!.length).toBeLessThan(60);
  });

  it('is in the example card, which still says "Example result, not a real audit" and the gate "Not ready by these checks"', () => {
    const out = renderToStaticMarkup(
      React.createElement(cardModule.HeroCard as never, { lang: 'en' }),
    );
    expect(out).toContain('hero-scene');
    expect(out).toContain('Example result, not a real audit');
    expect(out).toContain('Not ready by these checks');
    expect(out.indexOf('hero-scene')).toBeLessThan(out.indexOf('hero-rows'));
    expect(out.indexOf('hero-tiles')).toBeGreaterThan(out.indexOf('hero-rows'));
    expect(out.indexOf('hero-tiles')).toBeLessThan(out.indexOf('hero-gate-line'));
  });
});

describe('the dot-matrix numerals and the verdict tiles', () => {
  const render = (value: number) =>
    renderToStaticMarkup(
      React.createElement(numeral.DotNumeral as never, { value }),
    );

  it('draws a digit as a 5 by 7 grid of dots, and says the number in its label', () => {
    const one = render(1);
    expect(one.match(/<circle/g)).toHaveLength(35);
    expect(one.match(/class="dot-on"/g)).toHaveLength(10);
    expect(one).toContain('aria-label="1"');
    expect(one).toContain('role="img"');
    const twelve = render(12);
    expect(twelve.match(/<circle/g)).toHaveLength(70);
    expect(twelve).toContain('aria-label="12"');
  });

  it('a count that is not a whole number from 0 up is drawn as 0, never as a broken picture', () => {
    expect(numeral.digitsOf(-3)).toEqual(['0']);
    expect(numeral.digitsOf(Number.NaN)).toEqual(['0']);
    expect(numeral.digitsOf(7.9)).toEqual(['7']);
    expect(render(Number.NaN)).toContain('aria-label="0"');
  });

  it('every digit 0 to 9 has a glyph of 7 rows of 5 cells with at least one dot', () => {
    for (let d = 0; d <= 9; d++) {
      const out = render(d);
      expect(out.match(/<circle/g), String(d)).toHaveLength(35);
      expect(out.match(/class="dot-on"/g)!.length, String(d)).toBeGreaterThan(5);
    }
  });

  it('the three tiles are LEAKED, INCONCLUSIVE and BLOCKED, and their counts are the verdict badges of the rows', () => {
    expect(copy.TILES.map((t) => t.verdict)).toEqual([
      'LEAKED',
      'INCONCLUSIVE',
      'BLOCKED',
    ]);
    const card = read('components', 'hero-card.tsx');
    for (const tile of copy.TILES) {
      const badges = card.match(new RegExp(`<VerdictBadge verdict="${tile.verdict}"`, 'g')) ?? [];
      expect(tile.count, tile.verdict).toBe(badges.length);
    }
  });
});

describe('the words of A2', () => {
  const files = [
    'components/hero-scene.tsx',
    'components/dot-numeral.tsx',
    'components/hero-card.tsx',
    'app/page.tsx',
    'app/glass.css',
  ];

  it('no lock, tick, "full audit", "autonomous", "safe" or "secure" in the new or changed files', () => {
    for (const file of files) {
      const text = stripComments(read(...file.split('/')));
      expect(text, file).not.toMatch(/\block\b|\btick\b|padlock|checkmark|full audit|autonomous/i);
      expect(text, file).not.toMatch(/\bsafe(ly|ty)?\b|\bsecure[ds]?\b|\bguarantee/i);
    }
  });

  it('the copy of the scene and the tiles never claims safety', () => {
    const copy = read('lib', 'hero-copy.ts');
    const block = copy.slice(copy.indexOf('export const SCENE'), copy.indexOf('export const STEPS'));
    expect(block).not.toMatch(/\bsafe|\bsecure|guarantee|full audit|autonomous/i);
  });
});
