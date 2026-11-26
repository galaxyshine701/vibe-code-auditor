import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasTick } from './no-lock-tick.spec.js';

// The home page from top to bottom, its one container, the three steps with
// their pictures, the words, the footer and the text for search and sharing.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const SRC = join(FRONTEND, 'src');
const requireFrontend = createRequire(join(FRONTEND, 'package.json'));
const React = requireFrontend('react') as typeof import('react');
const { renderToStaticMarkup } = requireFrontend(
  'react-dom/server',
) as typeof import('react-dom/server');
const href = (...parts: string[]) => pathToFileURL(join(SRC, ...parts)).href;
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');

type Lang = 'en' | 'ur';
type Pair = { en: string; ur: string };
const copy = (await import(
  /* @vite-ignore */ href('lib', 'hero-copy.ts')
)) as typeof import('../../../frontend/src/lib/hero-copy');
const load = async (file: string, name: string) =>
  (
    (await import(/* @vite-ignore */ href('components', file))) as Record<string, unknown>
  )[name];
const How = await load('how-it-works.tsx', 'HowItWorks');
const Words = await load('word-meanings.tsx', 'WordMeanings');
const render = (component: unknown, lang: Lang) =>
  renderToStaticMarkup(React.createElement(component as never, { lang }));

const page = read('app', 'page.tsx');

describe('the order of the sections', () => {
  it('hero, what it checks, how it works, what you get, the words, Supabase', () => {
    const marks = [
      'className="hero hero-stage"',
      '<HeroScene',
      '<WhatItChecks',
      '<HowItWorks',
      'head={SECTIONS.get}',
      '<HeroCard',
      '<WordMeanings',
      'head={SECTIONS.advanced}',
      'id="advanced-supabase"',
    ];
    const at = marks.map((mark) => page.indexOf(mark));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the example result is only in "What you get", and the old accordion is gone', () => {
    expect(page.match(/<HeroCard\b/g)).toHaveLength(1);
    expect(page).not.toMatch(/CoverageNotes|truth-card|covers/);
    expect(page.indexOf('GET.body')).toBeLessThan(page.indexOf('<HeroCard'));
  });

  it('every section heading is the same: a small label, then the heading, in both languages', () => {
    for (const head of Object.values(copy.SECTIONS)) {
      for (const pair of [head.label, head.title] as Pair[]) {
        expect(pair.en.length).toBeGreaterThan(3);
        expect(pair.ur.length).toBeGreaterThan(3);
        expect(pair.en.endsWith('.')).toBe(false);
      }
    }
    const headComponent = read('components', 'section-head.tsx');
    expect(headComponent.indexOf('section-label')).toBeLessThan(headComponent.indexOf('<h2'));
  });
});

describe('one container', () => {
  const globals = read('app', 'globals.css');
  const glass = read('app', 'glass.css');

  it('is 1200px at most, with 24px at the sides and 16px on a phone', () => {
    expect(globals).toContain('width: min(1200px, calc(100% - 48px));');
    expect(globals).toMatch(/@media \(max-width: 720px\) \{\s*\.shell \{\s*width: calc\(100% - 32px\)/);
  });

  it('holds the home page, the header, the footer, the result page and the run page', () => {
    expect(page).toContain('className="shell home"');
    expect(read('components', 'app-header.tsx')).toContain('className="shell header-inner"');
    expect(read('components', 'site-footer.tsx')).toContain('className="shell footer-inner"');
    expect(read('app', 'audits', '[id]', 'page.tsx')).toContain('className="shell page-stack"');
    expect(read('app', 'audits', '[id]', 'report', 'page.tsx')).toContain('className="shell page-stack"');
  });

  it('has no narrow strip: no section is held to 760px', () => {
    expect(glass).not.toMatch(/max-width: (?:640|720|760)px;/);
  });

  it('keeps one gap between the sections: 72, 56 and 40px', () => {
    expect(glass).toMatch(/\.home \{[^}]*gap: 72px/);
    expect(glass).toMatch(/@media \(max-width: 1099px\) \{\s*\.home \{\s*gap: 56px/);
    expect(glass).toMatch(/\.home \{\s*gap: 40px/);
    expect(glass).toContain('max-width: 60ch');
  });
});

describe('how it works', () => {
  const html = render(How, 'en');

  it('three steps, with a title and a text, in both languages', () => {
    expect(copy.STEPS.map((s) => s.visual)).toEqual(['paste', 'run', 'result']);
    for (const lang of ['en', 'ur'] as const) {
      const out = render(How, lang);
      expect(out.match(/<li\b/g)).toHaveLength(3);
      for (const step of copy.STEPS) expect(out).toContain(step.title[lang]);
    }
  });

  const pictures = (lang: Lang) =>
    render(How, lang)
      .split('class="how-visual how-visual-')
      .slice(1)
      .map((part) => part.slice(0, part.indexOf('class="how-number"')));

  it('each has a small picture, hidden from a screen reader, with fewer than 60 shapes', () => {
    expect(pictures('en')).toHaveLength(3);
    expect(html.match(/class="how-visual how-visual-\w+" aria-hidden="true"/g)).toHaveLength(3);
    for (const picture of pictures('en')) {
      expect(picture.match(/<(span|div|svg|rect|circle|path)\b/g)!.length).toBeLessThan(60);
    }
  });

  it('the pictures hold real words: the field and its box, four checks, three verdicts, a prompt', () => {
    const [paste, run, result] = pictures('en');
    for (const text of ['github.com/you/your-app', 'I may scan these files', 'Check this repo']) {
      expect(paste).toContain(text);
    }
    for (const name of ['Secret keys in files', '.env files', 'Database rules', 'Site headers']) {
      expect(run).toContain(name);
    }
    for (const state of ['done', 'running', 'queued']) expect(run).toContain(`mv-row-${state}`);
    expect(run).toContain('mv-progress');
    for (const word of ['LEAKED', 'INCONCLUSIVE', 'BLOCKED']) expect(result).toContain(word);
    expect(result).toContain('A Supabase secret key was');
    const ur = pictures('ur');
    expect(ur[0]).toContain('Ye repo check karein');
    expect(ur[1]).toContain('Database ke rules');
  });

  it('draws no lock, tick or shield', () => {
    expect(read('components', 'how-it-works.tsx').replace(/^\/\/.*$/gm, '')).not.toMatch(
      /padlock|shackle|shield|checkmark/i,
    );
    for (const m of html.matchAll(/\bd="([^"]+)"/g)) expect(hasTick(m[1])).toBe(false);
  });

  it('the checks fill once, and show their last frame with reduced motion', () => {
    const glass = read('app', 'glass.css');
    expect(glass).toMatch(/\.mv-progress span \{[^}]*transform: scaleX\(0\.62\)/);
    expect(glass).toMatch(/animation: mvFill [\d.]+s ease-out [\d.]+s both;/);
    expect(glass).toContain('.how-steps[data-rise] .mv-progress span');
  });

  it('rises once, and not at all with reduced motion', () => {
    const source = read('components', 'how-it-works.tsx');
    expect(source).toContain('IntersectionObserver');
    expect(source).toContain('watch.disconnect()');
    expect(source).toContain('prefers-reduced-motion: reduce');
  });
});

describe('what the words mean', () => {
  it('three cards, one line each, and the clean result, in both languages', () => {
    for (const lang of ['en', 'ur'] as const) {
      const out = render(Words, lang);
      expect(out.match(/<li\b/g)).toHaveLength(3);
      for (const word of ['LEAKED', 'INCONCLUSIVE', 'BLOCKED']) expect(out).toContain(word);
      expect(out).toContain(copy.MEANING.clean[lang]);
    }
  });
});

describe('the footer, the intro and the messages', () => {
  it('the footer has the line, "Replay intro" and the theme button; the hero has no replay', () => {
    const footer = read('components', 'site-footer.tsx');
    expect(footer).toContain('FOOTER.line');
    expect(footer).toContain('hero-replay');
    expect(footer).toContain('<ThemeToggle />');
    expect(page).not.toContain('hero-replay');
    expect(copy.FOOTER.line.en).toBe('launch readiness checks, by these checks only');
    expect(read('app', 'layout.tsx')).toContain('<SiteFooter />');
  });

  it('the intro speaks both languages', () => {
    const overlay = read('components', 'intro-overlay.tsx');
    for (const key of ['INTRO_COPY.skip', 'INTRO_COPY.hint', 'INTRO_COPY.label']) {
      expect(overlay).toContain(key);
    }
    expect(copy.INTRO_COPY.skip.ur).toBe('Intro chhodein');
  });

  it("the page's own error and rate-limit messages speak Roman Urdu", async () => {
    const ui = (await import(/* @vite-ignore */ href('lib', 'ui-copy.ts'))) as {
      uiText: (m: string, l: Lang) => string;
      rateLimitText: (s: number, l: Lang) => string;
    };
    const network = /NETWORK_ERROR_MESSAGE =\s*'([^']+)'/.exec(read('lib', 'config.ts'))![1];
    expect(ui.uiText(network, 'ur')).not.toBe(network);
    expect(ui.uiText(network, 'en')).toBe(network);
    expect(ui.uiText('Access denied.', 'ur')).toBe('Ijazat nahi mili.');
    expect(ui.uiText('The server answered with status 502.', 'ur')).toContain('502');
    // a message of the server that is not known is shown as it came
    expect(ui.uiText('Something new from the server', 'ur')).toBe('Something new from the server');
    expect(ui.rateLimitText(30, 'en')).toBe('Too many wrong attempts. Try again in 30s.');
    expect(ui.rateLimitText(30, 'ur')).toContain('30s');
  });

  it('has a title, a description and Open Graph text that claim nothing', async () => {
    const brand = (await import(/* @vite-ignore */ href('lib', 'brand.ts'))) as Record<string, string>;
    const layout = read('app', 'layout.tsx');
    expect(layout).toContain('title: PROJECT_TITLE');
    expect(layout).toMatch(/openGraph: \{\s*title: PROJECT_TITLE,\s*description: PROJECT_DESCRIPTION,\s*type: 'website'/);
    expect(brand.PROJECT_DESCRIPTION).toContain('by these checks');
    expect(`${brand.PROJECT_TITLE} ${brand.PROJECT_DESCRIPTION}`).not.toMatch(
      /\bsafe|\bsecure|certifi|guarantee|full audit/i,
    );
  });
});
