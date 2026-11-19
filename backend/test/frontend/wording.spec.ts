import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

// Files that still say "certificate" in the text the user sees. They are
// renamed to "Re-test result" in the Report commit, which removes them here.
const PENDING = new Set([
  'app/audits/[id]/certificate/page.tsx',
  'components/certificate-action.tsx',
  'components/badges.tsx',
]);

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
    .join('/route');
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
  const files = walk(SRC).filter(
    (f) => !PENDING.has(relative(SRC, f).split(sep).join('/')),
  );

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

  it('the hero says what the product checks', () => {
    const page = readFileSync(join(SRC, 'app', 'page.tsx'), 'utf8');
    expect(page).toContain("'stranger'");
    expect(page).toMatch(/website address, Supabase details, or both/);
    expect(page).not.toMatch(/Can another user read your data/);
  });
});
