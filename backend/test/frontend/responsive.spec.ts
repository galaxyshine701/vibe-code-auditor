import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Round 5: the screen of a phone and the first paint. The frontend has no test
// runner of its own, so its files are read by path; the sizes themselves are
// checked by hand in a browser.
const SRC = join(__dirname, '..', '..', '..', 'frontend', 'src');
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');
const css = read('app', 'glass.css');
const globals = read('app', 'globals.css');
const layout = read('app', 'layout.tsx');
const phone = css.slice(css.indexOf('/* ---- the screen of a phone (round 5)'));

describe('the first screen does not wait for the script', () => {
  it('nothing is hidden before the page code runs', () => {
    expect(css).not.toContain('data-reveal-boot');
    expect(layout).not.toContain('REVEAL');
  });

  it('the hero of the home page is never wrapped in a reveal', () => {
    const page = read('app', 'page.tsx');
    const hero = page.slice(page.indexOf('<section className="hero hero-stage"'), page.indexOf('<WhatItChecks'));
    expect(hero).not.toMatch(/<Reveal\b|data-reveal/);
  });

  it('the words of the headline are visible within a stated time, and end at opacity 1', async () => {
    const { HEADLINE } = (await import(
      /* @vite-ignore */ pathToFileURL(join(SRC, 'lib', 'hero-copy.ts')).href
    )) as { HEADLINE: { en: string; ur: string } };
    const page = read('app', 'page.tsx');
    const [, first, step] = /animationDelay: `\$\{(\d+) \+ index \* (\d+)\}ms`/.exec(page)!.map(Number);
    const fade = Number(/heroWordIn ([\d.]+)s /.exec(globals)![1]) * 1000;
    // without an intro: the last word is there 3 s after it began, in both languages
    for (const words of [HEADLINE.en, HEADLINE.ur]) {
      const last = first + (words.split(' ').length - 1) * step;
      expect(last + fade).toBeLessThanOrEqual(3000);
    }
    // the end of both animations is fully visible
    for (const name of ['heroWordIn', 'heroWordShown']) {
      const body = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(globals)![1];
      expect(body, name).toMatch(/to \{\s*opacity: 1;/);
    }
    // the failsafe: 8 s plus the delay of a word, never paused by the intro
    expect(globals).toContain('heroWordShown 8s step-end forwards');
    expect(globals).toMatch(/\.hero-title \.hero-word \{\s*animation-play-state: paused, running;/);
  });

  it('the words are hidden only where a script and motion are there: else the headline is static', () => {
    const open = globals.indexOf('@media (scripting: enabled) and (prefers-reduced-motion: no-preference)');
    expect(open).toBeGreaterThan(-1);
    // outside that block nothing hides a word
    expect(/\n\.hero-word \{([^}]*)\}/.exec(globals)![1]).not.toMatch(/opacity|animation/);
    const inside = globals.slice(open, globals.indexOf('\n}\n', open));
    expect(inside).toContain('opacity: 0;');
    expect([...globals.matchAll(/\.hero-word[^{}]*\{[^}]*opacity: 0;/g)]).toHaveLength(1);
  });

  it('the fonts come from this site with swap, and no stylesheet blocks the first paint', () => {
    expect(layout).toContain("from 'next/font/google'");
    expect(layout.match(/display: 'swap'/g)).toHaveLength(3);
    expect(layout).not.toContain('fonts.googleapis.com');
    for (const name of ['bricolage', 'instrument', 'jetbrains']) {
      expect(globals).toContain(`var(--font-${name}, `);
    }
  });

  it('the sample data is not in the part every visitor downloads', () => {
    const api = read('lib', 'api.ts');
    expect(api).not.toMatch(/^import [^;]*from '\.\/mock(-bundle)?';/m);
    expect(api).toContain("import('./mock')");
    expect(api).toContain("import('./mock-bundle')");
  });
});

describe('a phone', () => {
  it('uses the whole screen and stays clear of the notch and the home bar', () => {
    expect(layout).toContain("viewportFit: 'cover'");
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(phone).toContain(`env(safe-area-inset-${side})`);
    }
  });

  it('every full height has the small screen unit after the old one', () => {
    for (const [, value] of globals.matchAll(/min-height: ((?:calc\()?\d+)vh/g)) {
      expect(globals).toContain(`min-height: ${value}svh`);
    }
  });

  it('things to press are at least 44 by 44', () => {
    const block = phone.slice(phone.indexOf('@media (max-width: 640px), (max-height: 500px), (pointer: coarse)'));
    for (const part of ['.brand', '.theme-toggle', '.segment', '.button', '.text-link', 'main summary', '.advanced-summary']) {
      expect(block).toContain(part);
    }
    expect(block).toContain('min-height: 44px');
    expect(block).toContain('min-width: 44px');
  });

  it('long names, addresses and code wrap inside their card; lines stay short on a wide screen', () => {
    expect(phone).toMatch(/\.evidence-subject,[\s\S]*?overflow-wrap: anywhere;/);
    expect(phone).toMatch(/max-width: 60ch;/);
  });

  it('the language switch is never squeezed or broken inside a word', () => {
    expect(phone).toMatch(/^\.segmented \{\s*flex: none;/m);
    expect(phone).toMatch(/^\.segment \{\s*white-space: nowrap;/m);
  });

  it('there is no big picture file to download', () => {
    expect(existsSync(join(SRC, 'app', 'icon.svg'))).toBe(true);
    for (const file of ['page.tsx', 'layout.tsx']) {
      expect(read('app', file)).not.toMatch(/<img\b|\.(png|jpe?g|webp|gif)['"]/);
    }
  });
});
