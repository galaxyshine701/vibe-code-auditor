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

// ---- the result page (VCA-H8): no shield with a check mark, no tick of any shape ----

/** The points of the straight parts of an SVG path (m, l, h, v and their capitals); a curve ends the part. */
export function straightParts(d: string): [number, number][][] {
  const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const tokens = [...d.matchAll(/([a-zA-Z])|(-?\d*\.?\d+(?:e-?\d+)?)/g)].map((m) => m[1] ?? Number(m[2]));
  const parts: [number, number][][] = [];
  let cur: [number, number][] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  const flush = () => {
    if (cur.length > 1) parts.push(cur);
    cur = [];
  };
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (typeof cmd !== 'string') continue;
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    const n = ARGS[lower];
    if (lower === 'z') {
      flush();
      continue;
    }
    let first = true;
    while (i < tokens.length && typeof tokens[i] === 'number') {
      const args = tokens.slice(i, i + n) as number[];
      i += n;
      if (lower === 'm' && first) {
        flush();
        x = rel ? x + args[0] : args[0];
        y = rel ? y + args[1] : args[1];
        cur = [[x, y]];
      } else if (lower === 'm' || lower === 'l') {
        x = rel ? x + args[0] : args[0];
        y = rel ? y + args[1] : args[1];
        cur.push([x, y]);
      } else if (lower === 'h') {
        x = rel ? x + args[0] : args[0];
        cur.push([x, y]);
      } else if (lower === 'v') {
        y = rel ? y + args[0] : args[0];
        cur.push([x, y]);
      } else {
        // a curve or an arc: the straight part ends here
        flush();
        x = rel ? x + args[n - 2] : args[n - 2];
        y = rel ? y + args[n - 1] : args[n - 1];
        cur = [[x, y]];
      }
      first = false;
    }
  }
  flush();
  return parts;
}

/** A check mark: a short stroke down and to the right, then a longer one up and to the right. */
export function hasTick(d: string): boolean {
  for (const part of straightParts(d)) {
    for (let k = 0; k + 2 < part.length; k++) {
      const v1 = [part[k + 1][0] - part[k][0], part[k + 1][1] - part[k][1]];
      const v2 = [part[k + 2][0] - part[k + 1][0], part[k + 2][1] - part[k + 1][1]];
      if (v1[0] > 0 && v1[1] > 0 && v2[0] > 0 && v2[1] < 0 && Math.hypot(...v2) > Math.hypot(...v1)) {
        return true;
      }
    }
  }
  return false;
}

describe('the detector of a tick', () => {
  it('finds the tick that was used, and the check mark of the old shield', () => {
    expect(hasTick('m5.3 8 1.8 1.8L10.8 6')).toBe(true);
    expect(hasTick('m10.4 16.6 3.7 3.7 7.5-8')).toBe(true);
    expect(hasTick('M4 12 L9 17 L20 6')).toBe(true);
  });
  it('does not find one in the plain shapes of the verdicts (a triangle, a bar, a question mark, a ring)', () => {
    expect(hasTick('M8 2.2 14.1 13H1.9L8 2.2Z')).toBe(false);
    expect(hasTick('M4.9 8h6.2')).toBe(false);
    expect(hasTick('M6.2 6.1a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.2v.4')).toBe(false);
    expect(hasTick('M3 12H21')).toBe(false);
    expect(hasTick('M7.2 17.6A7.6 7.6 0 1 1 16.8 17.6')).toBe(false);
  });
});

describe('the result page: no shield, no lock, no tick', () => {
  // the components of the result page and the pages of a run
  const RESULT = [
    'app/audits/[id]/report/page.tsx',
    'app/audits/[id]/certificate/page.tsx',
    'app/audits/[id]/page.tsx',
    'components/gate-banner.tsx',
    'components/verdict.tsx',
    'components/client-summary.tsx',
    'components/roadmap-list.tsx',
    'components/finding-card.tsx',
    'components/evidence-groups.tsx',
    'components/scope-buckets.tsx',
    'components/certificate-action.tsx',
    'components/fix-seal.tsx',
    'components/badges.tsx',
  ].map((path) => {
    const found = files.find((f) => f.path.split('\\').join('/') === path);
    return { path, text: found?.text ?? '' };
  });

  it('every one of these files exists (a rename must not make this test pass by reading nothing)', () => {
    for (const { path, text } of RESULT) expect(text.length, path).toBeGreaterThan(200);
  });

  it('no shield (not by name, not as the outline that was used), no lock, no check mark', () => {
    for (const { path, text } of RESULT) {
      expect(text, path).not.toMatch(/shield|padlock|shackle|checkmark|check-mark/i);
      // the outline of the old shield, and the check mark that sat in it
      expect(text, path).not.toContain('M8 1.8 13.4 4');
      expect(text, path).not.toContain('m5.3 8 1.8 1.8L10.8 6');
    }
  });

  it('no path of any component has the shape of a tick', () => {
    for (const { path, text } of files.filter((f) => f.path.endsWith('.tsx'))) {
      for (const m of text.matchAll(/\bd=["']([^"']+)["']/g)) {
        expect(hasTick(m[1]), `${path}: ${m[1]}`).toBe(false);
      }
    }
  });

  it('BLOCKED is a round mark with one bar across it, the same bar as the checkpoint lane', () => {
    const verdict = RESULT.find((f) => f.path.endsWith('verdict.tsx'))!.text;
    const blocked = verdict.slice(verdict.indexOf("verdict === 'BLOCKED'"), verdict.indexOf('<svg', verdict.indexOf("verdict === 'BLOCKED'") + 20) + 600);
    expect(blocked).toContain('<circle cx="8" cy="8" r="6" />');
    expect(blocked).toContain('<path d="M4.9 8h6.2" />');
    // the gate banner of a clear result uses this icon, so the result card has no shield any more
    const banner = RESULT.find((f) => f.path.endsWith('gate-banner.tsx'))!.text;
    expect(banner).toContain("clear: 'BLOCKED'");
  });
});
