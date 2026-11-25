import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The look of the home page's hero: no frame and no background of its own (one
// background for the whole page, in both themes), the widths, the scene of the
// table check (now in the Supabase section), the verdict tiles and their
// dot-matrix numerals, and the contrast of the words in both themes. The
// frontend has no test runner of its own, so its files are read by path. (The
// file keeps its old name: it was the glass stage.)
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
const globals = read('app', 'globals.css');

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

/** The body of the first rule written with exactly this selector. */
const rule = (selector: string, text = css) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(text);
  if (!match) throw new Error(`no rule ${selector}`);
  return match[1];
};

describe('one background for the whole page', () => {
  it('the hero has no frame, no background and no colours of its own', () => {
    for (const file of ['glass.css', 'hero.css']) {
      const text = stripComments(read('app', file));
      for (const match of text.matchAll(/([^{}]*\.hero-stage[^{}]*)\{([^}]*)\}/g)) {
        // rules about the hero itself (not about something inside it)
        if (!/\.hero-stage\s*$/.test(match[1].trim())) continue;
        expect(match[2], match[1]).not.toMatch(/border|background|box-shadow|--[\w-]+:/);
      }
      expect(text, file).not.toMatch(/--stage-base|--blob-|--glass-|backdrop-filter/);
    }
  });

  it('the headline is at most 1100px, the form and the example result 760px, all in the middle', () => {
    expect(rule('.hero-stage > .hero-copy')).toContain('max-width: 1100px');
    expect(css).toMatch(
      /\.hero-stage \.start-wrap,\s*\.hero-stage > \.hero-card-wrap,\s*\.hero-stage > \.hero-gate \{[^}]*max-width: 760px;[^}]*margin: 0 auto;/,
    );
    expect(rule('.hero.hero-stage')).toContain('justify-items: center');
    expect(rule('.hero-stage > .hero-copy')).toContain('text-align: center');
  });

  it('an anchor never leaves the top of the page under the sticky header', () => {
    expect(rule('html')).toMatch(/scroll-padding-top: \d+px/);
  });
});

// ---- contrast of the words, on the page of each theme ----
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
const over = (bg: Rgba, top: Rgba): Rgba => [
  bg[0] * (1 - top[3]) + top[0] * top[3],
  bg[1] * (1 - top[3]) + top[1] * top[3],
  bg[2] * (1 - top[3]) + top[2] * top[3],
  1,
];
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (c: Rgba) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const themeBlock = (selector: RegExp) => selector.exec(globals)![1];
const themes = {
  dark: themeBlock(/:root[^{]*\{([^}]*)\}/),
  light: themeBlock(/\[data-theme="light"\] \{([^}]*)\}/),
};

describe('text contrast (AA) in both themes', () => {
  for (const [name, block] of Object.entries(themes)) {
    const token = (t: string) =>
      color(new RegExp(`--${t}:\\s*([^;]+);`).exec(block)![1].trim());
    const page = token('bg');
    const card = over(page, token('panel'));
    const row = over(card, token('surface-soft'));

    it(`${name}: the words on the page, the card and the rows are at least 4.5:1`, () => {
      for (const word of ['ink', 'ink-soft', 'muted']) {
        for (const background of [page, card, row]) {
          expect(ratio(token(word), background), word).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${name}: the verdict words (LEAKED, BLOCKED, INCONCLUSIVE) on their tint are at least 4.5:1`, () => {
      for (const [word, tint] of [
        ['leak', 'leak-soft'],
        ['ok', 'ok-soft'],
        ['grey', 'grey-soft'],
      ]) {
        // the dark theme has a lighter red in the example and the scene
        const text =
          name === 'dark' && word === 'leak'
            ? color(
                /html:not\(\[data-theme="light"\]\) \.hero-scene \{\s*--leak: (#[0-9a-f]{6});/.exec(css)![1],
              )
            : token(word);
        expect(ratio(text, over(row, token(tint))), word).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('light: the amber numeral of a tile is darker, at least 3:1 (a graphic)', () => {
    const amber = /\[data-theme="light"\] \.hero-tile-inconclusive \{\s*--tone: (#[0-9a-f]{6});/.exec(css)![1];
    const block = themes.light;
    const token = (t: string) =>
      color(new RegExp(`--${t}:\\s*([^;]+);`).exec(block)![1].trim());
    expect(ratio(color(amber), over(token('bg'), token('panel')))).toBeGreaterThanOrEqual(3);
  });
});

describe('motion', () => {
  it('every animation of the scene moves only transform and opacity', () => {
    const names = [...new Set([...css.matchAll(/animation: (\w+) /g)].map((m) => m[1]))];
    expect(names.sort()).toEqual(
      ['sceneDown', 'sceneFade', 'sceneKey', 'sceneLand', 'sceneWalk'].sort(),
    );
    for (const name of names) {
      const body = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`).exec(css)![1];
      for (const prop of [...body.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1])) {
        expect(['opacity', 'transform'], `${name}: ${prop}`).toContain(prop);
      }
    }
  });

  it('with reduced motion, and on a phone (480 px), the scene is its last frame', () => {
    for (const query of [/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/, /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/]) {
      const block = query.exec(css)![1];
      for (const part of ['canary', 'glow', 'stranger', 'barrier-bar', 'key']) {
        expect(block).toContain(`.scene-${part}`);
      }
      expect(block).toContain('animation: none');
    }
  });

  it('there is no blur filter (a filter only on the numerals)', () => {
    expect(css.match(/(?<![-\w])filter:/g)).toHaveLength(1);
    expect(css).not.toMatch(/(?<![-\w])filter:\s*blur/);
  });
});

describe('the scene of the table check', () => {
  const scene = read('components', 'hero-scene.tsx');
  const page = read('app', 'page.tsx');
  const html = (lang: Lang) =>
    renderToStaticMarkup(
      React.createElement(sceneModule.HeroScene as never, { lang }),
    );

  it('is in the Supabase section, under a line that says it is an example, and not in the example result', () => {
    const at = (text: string) => page.indexOf(text);
    expect(at('id="advanced-supabase"')).toBeGreaterThan(-1);
    expect(at('<HeroScene')).toBeGreaterThan(at('id="advanced-supabase"'));
    expect(at('SCENE_NOTE, lang')).toBeGreaterThan(at('id="advanced-supabase"'));
    expect(at('SCENE_NOTE, lang')).toBeLessThan(at('<HeroScene'));
    expect(read('components', 'hero-card.tsx')).not.toContain('HeroScene');
    expect(copy.SCENE_NOTE).toEqual({
      en: 'Example scene, not a real audit',
      ur: 'Misaal ka manzar, asli audit nahi',
    });
  });

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
      expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    }
    expect(copy.SCENE.label.ur).toContain('Misaal');
  });

  it('is light: one SVG, a gradient for the glow (no filter), few shapes', () => {
    const out = html('en');
    expect(out.match(/<svg/g)).toHaveLength(1);
    expect(out).not.toContain('<filter');
    expect(out.match(/<(circle|rect|path|ellipse)\b/g)!.length).toBeLessThan(60);
  });

  it('takes its colours from the theme, so it can be seen in both', () => {
    const block = css.slice(css.indexOf('.hero-scene {'), css.indexOf('.hero-tiles {'));
    expect(block).not.toMatch(/rgba\(255, 255, 255/);
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

  it('the two tiles are LEAKED and INCONCLUSIVE, and their counts are the verdict badges of the rows', () => {
    expect(copy.TILES.map((t) => t.verdict)).toEqual(['LEAKED', 'INCONCLUSIVE']);
    const card = read('components', 'hero-card.tsx');
    for (const tile of copy.TILES) {
      const badges = card.match(new RegExp(`<VerdictBadge verdict="${tile.verdict}"`, 'g')) ?? [];
      expect(tile.count, tile.verdict).toBe(badges.length);
    }
    expect(card).not.toContain('verdict="BLOCKED"');
    const out = renderToStaticMarkup(
      React.createElement(cardModule.HeroCard as never, { lang: 'en' }),
    );
    expect(out.indexOf('hero-tiles')).toBeGreaterThan(out.indexOf('hero-rows'));
    expect(out.indexOf('hero-tiles')).toBeLessThan(out.indexOf('hero-gate-line'));
    expect(out).toContain('Example result, not a real audit');
    expect(out).toContain('Not ready by these checks');
  });
});

describe('the words of the hero', () => {
  const files = [
    'components/hero-scene.tsx',
    'components/dot-numeral.tsx',
    'components/hero-card.tsx',
    'app/page.tsx',
    'app/glass.css',
  ];

  it('no lock, tick, "full audit", "autonomous", "safe" or "secure"', () => {
    for (const file of files) {
      const text = stripComments(read(...file.split('/')));
      expect(text, file).not.toMatch(/\block\b|\btick\b|padlock|checkmark|full audit|autonomous/i);
      expect(text, file).not.toMatch(/\bsafe(ly|ty)?\b|\bsecure[ds]?\b|\bguarantee/i);
    }
  });
});
