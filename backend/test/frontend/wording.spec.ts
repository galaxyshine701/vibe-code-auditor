import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The words of the UI (R38, R87, R88): never "safe", "secure", "certified",
// "guaranteed" or "certificate" as the UI's own words, and never MCP or Jira.
// The frontend has no test runner of its own, so this test reads its files.
const SRC = join(__dirname, '..', '..', '..', 'frontend', 'src');

const BANNED: [string, RegExp][] = [
  ['safe', /\bsafe(ly|ty)?\b/i],
  ['secure', /\bsecure[ds]?\b/i],
  ['certified', /\bcertifi(ed|cate)\b/i],
  ['guaranteed', /\bguarantee[ds]?\b/i],
  ['MCP', /\bmcp\b/i],
  ['Jira', /\bjira\b/i],
  ['mehfooz', /\b(mehfooz|mahfooz|surakshit|zamanat)\b/i],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const QUOTE = String.fromCharCode(39, 34, 96);
const BACKSLASH = String.fromCharCode(92);
// a string literal: a quote, anything (with escapes), the same quote
const LITERAL = new RegExp(
  `([${QUOTE}])((?:${BACKSLASH}${BACKSLASH}.|(?!${BACKSLASH}1)[^${BACKSLASH}${BACKSLASH}])*)${BACKSLASH}1`,
  'g',
);

/** The text a person can see: string literals and JSX text, without comments. */
export function visibleText(source: string, jsx: boolean): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // the route name is code, not words
    .split('/certificate')
    .join('/route')
    // class names are code, not words (the Re-test result screen keeps the old
    // class names of its styles)
    .replace(/className\s*=\s*"[^"]*"/g, '')
    .replace(/className\s*=\s*\{`[^`]*`\}/g, '');
  const parts: string[] = [];
  // an interpolation is code, not words
  for (const m of code.matchAll(LITERAL)) {
    parts.push(m[2].replace(/\$\{[^}]*\}/g, ' '));
  }
  if (jsx) {
    for (const m of code.matchAll(/>([^<>{}=]+)</g)) parts.push(m[1]);
  }
  return parts;
}

describe('the words of the UI', () => {
  // every file of the frontend: nothing is exempt any more (the old Certificate
  // screen is called "Re-test result" now, R87)
  const files = walk(SRC);

  for (const [name, pattern] of BANNED) {
    it(`never says "${name}" in its own words`, () => {
      const offenders = files.filter((file) =>
        visibleText(readFileSync(file, 'utf8'), file.endsWith('.tsx')).some(
          (t) => pattern.test(t),
        ),
      );
      expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
    });
  }

  it('the hero says what the product checks (its words are in hero-copy.ts)', () => {
    const copy = readFileSync(join(SRC, 'lib', 'hero-copy.ts'), 'utf8');
    expect(copy).toContain('Paste a GitHub repo. See what a stranger could reach, and how to fix it.');
    expect(copy).toContain('Repo and website checks use no AI. AI is used only to explain Supabase findings.');
    expect(copy).toContain('Looks for secret keys, committed .env files, missing database rules and weak site headers.');
    expect(copy).not.toMatch(/Supabase details, or both/);
    const page = readFileSync(join(SRC, 'app', 'page.tsx'), 'utf8');
    expect(page).toContain('headlineWords(lang)');
    expect(page).not.toMatch(/Can another user read your data/);
  });
});

describe('the severity words and the Re-test result page, in Roman Urdu', () => {
  const front = join(__dirname, '..', '..', '..', 'frontend', 'src');
  const load = (file: string) =>
    import(/* @vite-ignore */ pathToFileURL(join(front, 'lib', file)).href);

  it('each severity has both words; one the UI does not know is shown as given', async () => {
    const copy = (await load('stage-copy.ts')) as typeof import('../../../frontend/src/lib/stage-copy');
    for (const [id, en] of [['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['info', 'Info']]) {
      expect(copy.severityText(id, 'en')).toBe(en);
      expect(copy.severityText(id, 'ur').length).toBeGreaterThan(2);
    }
    expect(copy.severityText('critical', 'ur')).not.toBe('Critical');
    expect(copy.severityText('urgent', 'ur')).toBe('urgent');
    expect(copy.t('ur', 'nothingToShow')).toContain('In checks');
    expect(copy.t('en', 'nothingToShow')).toBe('Nothing to fix or show from these checks.');
  });

  it('every label of the Re-test result page has Roman Urdu, with English as the fallback', async () => {
    const ui = (await load('ui-copy.ts')) as typeof import('../../../frontend/src/lib/ui-copy');
    const page = readFileSync(join(front, 'app', 'audits', '[id]', 'certificate', 'page.tsx'), 'utf8');
    const labels = [...page.matchAll(/\bw\('([^']+)'\)/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(12);
    for (const label of labels) {
      expect(ui.uiText(label, 'ur'), label).not.toBe(label === 'Access code' ? '' : label);
      expect(ui.uiText(label, 'en')).toBe(label);
    }
    expect(ui.uiText('A text of the server', 'ur')).toBe('A text of the server');
  });
});
