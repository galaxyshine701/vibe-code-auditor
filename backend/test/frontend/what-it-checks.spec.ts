import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHECKS, REPO_CHECK } from '../../src/stages/planner-config.js';

// The strip "What it checks" under the hero: four items, and a "Not checked"
// line that may only say what the checks themselves report as their limits.
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
const copy = (await import(
  /* @vite-ignore */ href('lib', 'hero-copy.ts')
)) as typeof import('../../../frontend/src/lib/hero-copy');
const strip = (await import(
  /* @vite-ignore */ href('components', 'what-it-checks.tsx')
)) as { WhatItChecks: (p: { lang: Lang }) => unknown };
const render = (lang: Lang) =>
  renderToStaticMarkup(
    React.createElement(strip.WhatItChecks as never, { lang }),
  );

describe('what it checks', () => {
  it('has four items with one line each, in both languages', () => {
    expect(copy.WHAT_IT_CHECKS.items.map((i) => i.title.en)).toEqual([
      'Secret keys in files',
      'Committed .env files',
      'Database rules (RLS) in migrations',
      'Site headers and keys in site scripts',
    ]);
    for (const lang of ['en', 'ur'] as const) {
      const out = render(lang);
      expect(out.match(/<li\b/g)).toHaveLength(4);
      for (const item of copy.WHAT_IT_CHECKS.items) {
        expect(out).toContain(item.title[lang]);
        expect(item.body[lang].length).toBeGreaterThan(20);
      }
    }
  });

  it('every part of "Not checked" is a limit the checks report', () => {
    const limits = [...CHECKS, REPO_CHECK]
      .flatMap((check) => check.limits.map((limit) => limit.en))
      .join('\n');
    for (const part of copy.WHAT_IT_CHECKS.notChecked) {
      expect(limits, part.en).toContain(part.limit);
      expect(part.ur.length).toBeGreaterThan(5);
    }
  });

  it('each card says what it reads, in a tag', () => {
    const out = render('en');
    expect(out.match(/class="reads-tag"/g)).toHaveLength(4);
    for (const item of copy.WHAT_IT_CHECKS.items) {
      expect(item.reads.en).toMatch(/^reads: /);
      expect(item.reads.ur).toMatch(/^parhta hai: /);
    }
  });

  it('says "by these checks" and lists every part, in both languages', () => {
    expect(copy.WHAT_IT_CHECKS.notCheckedLead.en).toBe(
      'Not checked by these checks:',
    );
    for (const lang of ['en', 'ur'] as const) {
      const out = render(lang);
      for (const part of copy.WHAT_IT_CHECKS.notChecked) {
        expect(out).toContain(part[lang]);
      }
    }
  });

  it('is under the hero and above the steps', () => {
    const page = read('app', 'page.tsx');
    expect(page.indexOf('<WhatItChecks')).toBeGreaterThan(page.indexOf('<HeroScene'));
    expect(page.indexOf('<WhatItChecks')).toBeLessThan(page.indexOf('<HowItWorks'));
  });

  it('claims nothing and draws no lock or tick', () => {
    const text = [
      render('en'),
      render('ur'),
      read('components', 'what-it-checks.tsx'),
    ].join('\n');
    expect(text).not.toMatch(
      /\bsafe(ly|ty)?\b|\bsecure[ds]?\b|\bcertifi(ed|cate)\b|\bguarantee|full audit|padlock|checkmark|\block\b|\btick\b/i,
    );
  });
});
