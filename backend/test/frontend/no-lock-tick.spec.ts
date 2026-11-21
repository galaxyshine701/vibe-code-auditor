import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// No lock and no tick (check mark) anywhere in the frontend: not in the hero,
// not in the intro, not on the result view button, not on the Fix confirmed
// seal. A verdict is shown by words, colour and plain shapes. The frontend has
// no test runner of its own, so its files are read by path.
const SRC = join(__dirname, '..', '..', '..', 'frontend', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'mock-bundles' ? [] : walk(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}
const files = walk(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  text: readFileSync(path, 'utf8'),
}));

describe('no lock and no tick in the frontend', () => {
  it('no padlock, shackle, lock shape or check mark in any component or style', () => {
    for (const { path, text } of files) {
      expect(text, path).not.toMatch(
        /padlock|shackle|seal-check|sealCheck|motion-lock|checkmark|check-mark|\bunlock(?:ed|ing)? ?icon\b/i,
      );
    }
  });

  it('no tick-shaped SVG path (a short down stroke then a longer up stroke) in any component', () => {
    for (const { path, text } of files.filter((f) => f.path.endsWith('.tsx'))) {
      // the tick that was used: d="m10.4 16.6 3.7 3.7 7.5-8" ; any "m a b c d e-f" with a short stroke
      expect(text, path).not.toMatch(/d="[mM]\s?[\d.]+\s[\d.]+\s[\d.]+\s[\d.]+\s[\d.]+-[\d.]+"/);
    }
  });

  it('no check mark or lock character in the visible words', () => {
    for (const { path, text } of files.filter((f) => f.path.endsWith('.tsx'))) {
      expect(text, path).not.toMatch(/[✓✔✅\u{1F512}\u{1F513}\u{1F510}]/u);
    }
  });

  it('the Fix confirmed seal is a ring, a filled dot and the canary dot', () => {
    const seal = files.find((f) => f.path.endsWith('fix-seal.tsx'))!.text;
    expect(seal).toContain('seal-ring');
    expect(seal).toContain('seal-core');
    expect(seal).toContain('seal-canary');
  });

  it('the result view button has a round mark (dashed ring, then a filled dot), not a lock', () => {
    const action = files.find((f) => f.path.endsWith('certificate-action.tsx'))!.text;
    expect(action).toContain('cert-mark-ring');
    expect(action).toContain('cert-mark-fill');
    expect(action).toContain('Open result view');
  });
});
