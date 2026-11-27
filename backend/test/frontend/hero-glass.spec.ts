import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The look of the home page: no frame and no background around the hero (one
// background for the whole page, in both themes), glass cards with soft blobs
// behind them only, the scene of the hero, the verdict tiles and their
// counts, and the contrast of the words in both themes on the worst
// case of the glass. The frontend has no test runner of its own, so its files
// are read by path.
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
      expect(text, file).not.toMatch(/--stage-base/);
    }
  });

  it('wide screens: two columns; narrower: one column, as wide as the container', () => {
    const base = rule('.hero.hero-stage');
    expect(base).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(base).toContain('align-items: start');
    expect(base).not.toContain('max-width');
    const wide = /@media \(min-width: 1100px\) \{\s*\.hero\.hero-stage \{([^}]*)\}/.exec(css)![1];
    expect(wide).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);');
  });

  it('an anchor never leaves the top of the page under the sticky header', () => {
    expect(rule('html')).toMatch(/scroll-padding-top: \d+px/);
  });
});

describe('the glass cards', () => {
  it('have a gradient over a scrim, a blur, a light edge and a light along the top', () => {
    const glass = rule('.glass');
    expect(glass).toContain('linear-gradient(150deg, var(--glass-hi), var(--glass-lo))');
    expect(glass).toContain('var(--glass-scrim)');
    expect(glass).toContain('border: 1px solid var(--glass-edge)');
    expect(glass).toContain('backdrop-filter: var(--glass-blur)');
    expect(glass).toContain('-webkit-backdrop-filter: var(--glass-blur)');
    expect(glass).toContain('inset 0 1px 0 var(--glass-top)');
  });

  it('are the form, the scene, the cards of every section, the example and the Supabase box', () => {
    const source = [
      'app/page.tsx',
      'components/hero-scene.tsx',
      'components/hero-card.tsx',
      'components/what-it-checks.tsx',
      'components/how-it-works.tsx',
      'components/word-meanings.tsx',
    ].map((f) => read(...f.split('/'))).join('\n');
    for (const name of ['start-box glass', 'hero-scene glass', 'hero-card glass', 'how-step glass', 'advanced glass']) {
      expect(source).toContain(name);
    }
    expect(source).toContain('<li className="glass"');
    expect(source).toMatch(/word-card word-\$\{kind\} glass/);
  });

  it('blobs are radial gradients behind a wrapper of cards: into the side margins, never up or down to a heading', () => {
    const blobs = rule('.glass-wrap::before');
    expect(blobs).toContain('inset: 0 -140px;');
    expect(css).toMatch(/\.site-main:has\(\.home\) \{\s*overflow-x: clip;/);
    expect(blobs).toContain('z-index: -1');
    const shapes = [...blobs.matchAll(/radial-gradient\((\d+)% (\d+)% at (\d+)% (\d+)%/g)];
    // five or more wrappers carry them over the page, each with its own mix
    expect(css.match(/\.glass-wrap \{\n  --blob-a:/g)!.length).toBeGreaterThanOrEqual(5);
    // static: no animation on them
    expect(blobs).not.toContain('animation');
    expect(shapes).toHaveLength(3);
    for (const [, rx, ry, x, y] of shapes.map((m) => m.map(Number))) {
      expect(x - rx).toBeGreaterThanOrEqual(0);
      expect(x + rx).toBeLessThanOrEqual(100);
      expect(y - ry).toBeGreaterThanOrEqual(0);
      expect(y + ry).toBeLessThanOrEqual(100);
    }
    expect(css).not.toMatch(/(?<![-\w])filter:\s*blur/);
  });

  it('a card has a light edge, a light along the top and a coloured shadow', () => {
    const glass = rule('.glass');
    expect(glass).toContain('inset 1px 0 0 var(--glass-edge)');
    expect(glass).toContain('var(--glass-tint)');
  });

  it('the light theme has a warm page', () => {
    expect(themes.light).toContain('--bg: #f4efe5;');
    expect(read('components', 'theme-toggle.tsx')).toContain("light: '#f4efe5'");
  });

  it('the start button glows when it can be pressed, and is tinted, not grey, when it cannot', () => {
    expect(css).toMatch(/\.start-box \.button-primary:not\(:disabled\) \{\s*box-shadow:\s*0 0 0 3px/);
    expect(rule('.start-box .button-primary:disabled')).toContain('opacity: 1;');
    expect(rule('.start-box .button-primary:disabled')).toContain('background: var(--canary-soft)');
  });

  it('a phone: a lighter blur and no light sweep', () => {
    const phone = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}\n/.exec(css)![1];
    expect(phone).toContain('--glass-blur: blur(8px)');
    expect(phone).toMatch(/\.hero-scene::after \{\s*display: none/);
  });

  it('without backdrop-filter the card is more solid, in both themes', () => {
    const block = css.slice(css.indexOf('@supports not'));
    expect(block).toMatch(/--glass-scrim: rgba\(20, 22, 30, 0\.94\)/);
    expect(block).toMatch(/--glass-scrim: rgba\(255, 255, 255, 0\.92\)/);
  });
});

describe('the colours of the glows', () => {
  it('every blob and halo is the brand amber, a status colour or a neutral tint of the theme', () => {
    const declared = [...css.matchAll(/--(blob-[\w-]+|glass-tint|visual-glow):\s*([^;]+);/g)];
    expect(declared.length).toBeGreaterThan(10);
    for (const [, name, value] of declared) {
      expect(value, name).toMatch(
        /^(var\(--blob-(amber|green|neutral)\)|color-mix\(in srgb, var\(--(canary|ok|leak|ink)\) \d+%, transparent\))$/,
      );
    }
    expect(css).not.toMatch(/violet|rgba\(1[35]0, (95|115)|rgba\(246, (190|201)/);
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
/** A colour of a theme: written out, or `color-mix` of a token with transparent. */
function resolve(value: string, theme: string): Rgba {
  const mix = /^color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, transparent\)$/.exec(value);
  if (!mix) return color(value);
  const base = new RegExp(`--${mix[1]}:\\s*([^;]+);`).exec(theme)![1].trim();
  const [r, g, b, a] = color(base);
  return [r, g, b, (a * Number(mix[2])) / 100];
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

describe('text contrast (AA) in both themes, on the worst case of the glass', () => {
  const glassBlock = {
    dark: /(?:^|\n):root \{([^}]*--glass-scrim[^}]*)\}/.exec(css)![1],
    light: /(?:^|\n)\[data-theme="light"\] \{([^}]*--glass-scrim[^}]*)\}/.exec(css)![1],
  };
  for (const [name, block] of Object.entries(themes) as ['dark' | 'light', string][]) {
    const value = (t: string, text: string) =>
      resolve(new RegExp(`--${t}:\\s*([^;]+);`).exec(text)![1].trim(), block);
    const token = (t: string) => value(t, block);
    const glass = (t: string) => value(t, glassBlock[name]);
    const page = token('bg');
    // behind a card: the page alone, or a blob at its strongest (even all three on top of each other)
    const blobs = ['blob-amber', 'blob-green', 'blob-neutral'].map(glass);
    const behind = [page, ...blobs.map((b) => over(page, b)), blobs.reduce(over, page)];
    const cards = behind.flatMap((back) => {
      const scrim = over(back, glass('glass-scrim'));
      return [over(scrim, glass('glass-hi')), over(scrim, glass('glass-lo'))];
    });
    const rows = cards.map((card) => over(card, token('surface-soft')));
    // the colours a card sets again for the words on it
    const onGlass = (
      name === 'dark'
        ? /html:not\(\[data-theme="light"\]\) \.glass \{([^}]*)\}/
        : /(?:^|\n)\[data-theme="light"\] \.glass \{([^}]*)\}/
    ).exec(css)![1];
    const word = (t: string): Rgba => {
      if (t === 'canary-word' && name === 'dark') return token('canary');
      const own = new RegExp(`--${t}:\\s*(#[0-9a-f]{6});`).exec(onGlass);
      return own ? color(own[1]) : token(t);
    };

    it(`${name}: the words on the page are at least 4.5:1, with a blob behind them too`, () => {
      for (const t of ['ink', 'ink-soft', 'muted']) {
        expect(ratio(token(t), page), t).toBeGreaterThanOrEqual(4.5);
      }
      // (no blob is placed behind words; this is the margin if one reached them)
      for (const blob of blobs) {
        expect(ratio(token('ink'), over(page, blob))).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: the words on the cards and their rows are at least 4.5:1`, () => {
      for (const t of ['ink', 'ink-soft', 'muted']) {
        for (const background of [...cards, ...rows]) {
          expect(ratio(word(t), background), t).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${name}: the coloured words of the scene and the pictures are at least 4.5:1`, () => {
      for (const t of ['leak', 'ok', 'canary-word']) {
        for (const background of [...cards, ...rows]) {
          expect(ratio(word(t), background), t).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${name}: the verdict badges on their tint are at least 4.5:1`, () => {
      for (const [t, tint] of [
        ['leak', 'leak-soft'],
        ['ok', 'ok-soft'],
        ['grey', 'grey-soft'],
      ]) {
        for (const background of rows) {
          expect(ratio(word(t), over(background, token(tint))), t).toBeGreaterThanOrEqual(4.5);
        }
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

describe('the result page and the run page', () => {
  const report = read('app', 'audits', '[id]', 'report', 'page.tsx');
  const run = read('app', 'audits', '[id]', 'page.tsx');

  it('their cards are the glass of the home page', () => {
    for (const [file, name] of [
      ['gate-banner', 'gate-banner gate-${tone} glass'],
      ['client-summary', 'card client-summary glass'],
      ['scope-buckets', 'card scope-card glass'],
      ['roadmap-list', 'card roadmap-card glass'],
      ['evidence-groups', 'card evidence-card glass'],
      ['badges', 'card badges-card glass'],
      ['before-after', 'card before-after glass'],
      ['finding-card', 'finding-${finding.verdict.toLowerCase()} glass'],
    ]) {
      expect(read('components', `${file}.tsx`), file).toContain(name);
    }
    expect(run).toContain('card progress-card glass');
    for (const text of [report, run]) {
      expect(text).toContain('result-cards glass-wrap');
      expect(text).not.toMatch(/className="card [\w-]+-card"/);
    }
  });

  it('the wrapper of the findings leaves their two columns as they are', () => {
    expect(css).toMatch(/\.result-cards:not\(\.findings-grid\) \{\s*display: grid;/);
    expect(css).not.toMatch(/^\.result-cards \{/m);
  });

  it('the halo is only around the wrappers of cards, and the page cuts it at its edge', () => {
    expect(css).toMatch(/\.site-main:has\(\.page-stack\) \{\s*overflow-x: clip;/);
    expect(css).not.toMatch(/\.page-stack::before|\.report-heading::before/);
  });

  it('no next step and no evidence: one line instead of two empty cards, never for a failed run', () => {
    expect(report).toContain('{nothing ? null : (');
    expect(report).toContain('{nothing && !failed ? (');
    expect(report).toContain("t(language, 'nothingToShow')");
  });

  it('a focus ring is only for :focus-visible, and no text cursor stands beside a heading', () => {
    for (const file of ['globals.css', 'glass.css', 'report.css', 'stage.css', 'hero.css']) {
      expect(stripComments(read('app', file)), file).not.toMatch(/:focus(?!-visible)/);
    }
    expect(css).toMatch(/\.report-heading h1 \{\s*caret-color: transparent;/);
  });
});

describe('motion', () => {
  const scene = ['sceneCard', 'sceneDown', 'sceneFade', 'sceneKey', 'sceneLand', 'sceneShine', 'sceneWalk'];

  it('every animation of the page style moves only transform and opacity', () => {
    const names = [...new Set([...css.matchAll(/animation: (\w+) /g)].map((m) => m[1]))];
    expect(names.sort()).toEqual([...scene, 'heroSweep', 'howFade'].sort());
    for (const name of names) {
      const body = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`).exec(css)![1];
      for (const prop of [...body.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1])) {
        expect(['opacity', 'transform'], `${name}: ${prop}`).toContain(prop);
      }
    }
  });

  it('the scene plays again and again, and starts after the intro', () => {
    for (const name of scene) {
      expect(css).toMatch(new RegExp(`animation: ${name} 7s ease-in-out infinite both`));
    }
    for (const state of ['pending', 'opening', 'leaving']) {
      expect(css).toContain(`html[data-intro="${state}"] .hero-scene *`);
    }
  });

  it('with reduced motion nothing moves', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n/.exec(css)![1];
    for (const part of ['canary', 'glow-canary', 'stranger', 'barrier-bar', 'key', 'glow-key', 'fix']) {
      expect(block).toContain(`.scene-${part}`);
    }
    expect(block).toContain('.hero-scene::after');
    expect(block).toContain('.how-steps[data-rise] .how-step');
    expect(block).toContain('animation: none');
  });

  it('a card never moves: every fade of a card or a row is opacity only, once', () => {
    const sheets = [css, globals, read('app', 'report.css'), read('app', 'stage.css')].join('\n');
    for (const name of ['howFade', 'rise', 'textReveal', 'gateRise', 'evidenceIn', 'rowIn']) {
      const body = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(sheets)![1];
      expect(body, name).toContain('opacity');
      expect(body, name).not.toMatch(/transform|translate|scale/);
    }
    expect(css).not.toMatch(/animation: howFade[^;]*infinite/);
    expect(sheets).not.toContain('will-change');
  });
});

describe('the scene of the hero', () => {
  const scene = read('components', 'hero-scene.tsx');
  const page = read('app', 'page.tsx');
  const html = (lang: Lang) =>
    renderToStaticMarkup(
      React.createElement(sceneModule.HeroScene as never, { lang }),
    );

  it('is in the hero, once, with the line that says it is an example inside the card', () => {
    const at = (text: string) => page.indexOf(text);
    expect(page.match(/<HeroScene\b/g)).toHaveLength(1);
    expect(at('<HeroScene')).toBeGreaterThan(at('</form>'));
    expect(at('<HeroScene')).toBeLessThan(at('<WhatItChecks'));
    for (const lang of ['en', 'ur'] as const) {
      const out = html(lang);
      const note = out.indexOf(copy.SCENE_NOTE[lang]);
      expect(note).toBeGreaterThan(out.indexOf('scene-grid'));
      expect(note).toBeLessThan(out.indexOf('</figure>'));
    }
    expect(read('components', 'hero-card.tsx')).not.toContain('HeroScene');
    expect(copy.SCENE_NOTE).toEqual({
      en: 'Example scene, not a real audit',
      ur: 'Misaal ka manzar, asli audit nahi',
    });
  });

  it('has a fourth thing, after the window: a card "Fix prompt: steps that close it" that fades in, in the middle', () => {
    expect(copy.SCENE.fix.title.en).toBe('Fix prompt:');
    expect(copy.SCENE.fix.note.en).toBe('steps that close it');
    expect(copy.SCENE.fix.note.ur.length).toBeGreaterThan(8);
    const out = html('en');
    expect(out.match(/class="scene-panel /g)).toHaveLength(4);
    expect(out.indexOf('scene-panel-fix')).toBeGreaterThan(out.indexOf('scene-panel-key'));
    expect(out).toContain('scene-card');
    const moves = /@keyframes sceneCard \{([\s\S]*?)\n\}\n/.exec(css)![1];
    expect(moves).not.toContain('transform');
  });

  it('is two by two, and fills the height of its column: the two columns of the hero are one height', () => {
    expect(rule('.scene-grid')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(rule('.scene-grid')).toContain('flex: 1 1 auto');
    const wide = /@media \(min-width: 1100px\) \{([\s\S]*?)\n\}\n/.exec(css)![1];
    expect(wide).toContain('align-items: stretch');
    expect(css).toMatch(/\.hero-visual > \.glass-wrap \{\s*display: grid;/);
    const padding = /\.hero-scene \{[^}]*padding: \d+px \d+px (\d+)px;/.exec(css)![1];
    expect(Number(padding)).toBeLessThanOrEqual(24);
  });

  it('draws a marker on a post, an attempt at a striped barrier, and an app with a key in a window', () => {
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
    expect(scene).not.toMatch(/<img|from '(?!react')[^'.@][^']*'/);
  });

  it('says INCONCLUSIVE, BLOCKED and LEAKED in words, in general terms, in both languages', () => {
    for (const lang of ['en', 'ur'] as const) {
      const out = html(lang);
      for (const word of ['INCONCLUSIVE', 'BLOCKED', 'LEAKED']) expect(out).toContain(word);
      expect(out).toContain('<figcaption');
      expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    }
    expect(copy.SCENE.marker.verdict).toBe('INCONCLUSIVE');
    expect(copy.SCENE.barrier.verdict).toBe('BLOCKED');
    expect(copy.SCENE.key.verdict).toBe('LEAKED');
    expect(JSON.stringify(copy.SCENE)).not.toMatch(/supabase|canary|table/i);
    expect(copy.SCENE.label.ur).toContain('Misaal');
  });

  it('is light: four small SVGs, gradients for the glow (no filter), few shapes', () => {
    const out = html('en');
    const pictures = out.match(/<svg[\s\S]*?<\/svg>/g)!;
    expect(pictures).toHaveLength(4);
    expect(out).not.toContain('<filter');
    for (const svg of pictures) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg.match(/<(circle|rect|path|ellipse)\b/g)!.length).toBeLessThan(30);
    }
  });

  it('takes its colours from the theme, so it can be seen in both', () => {
    const block = css.slice(css.indexOf('.hero-scene {'), css.indexOf('.checks-list,'));
    expect(block).not.toMatch(/rgba\(255, 255, 255/);
  });
});

describe('the verdict tiles', () => {
  it('write their count as a plain number that can be read', () => {
    const out = renderToStaticMarkup(
      React.createElement(cardModule.HeroCard as never, { lang: 'en' }),
    );
    const counts = [...out.matchAll(/<span class="hero-tile-count">(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(counts).toEqual(copy.TILES.map((tile) => tile.count));
    expect(rule('.hero-tile-count')).toMatch(/font-size: [\d.]+rem/);
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
    'components/hero-card.tsx',
    'components/how-it-works.tsx',
    'components/word-meanings.tsx',
    'components/site-footer.tsx',
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
