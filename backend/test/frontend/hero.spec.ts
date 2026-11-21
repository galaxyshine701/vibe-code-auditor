import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The hero of the home page: its words (frontend/src/lib/hero-copy.ts) and how
// the example run, the chips, the steps and the honesty line are built. The
// frontend has no test runner of its own, so the files are loaded or read here.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const read = (...parts: string[]) =>
  readFileSync(join(FRONTEND, 'src', ...parts), 'utf8');

type Pair = { en: string; ur: string };
const copy = (await import(
  /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'hero-copy.ts'))
    .href
)) as {
  HEADLINE: Pair;
  headlineWords: (lang: 'en' | 'ur') => string[];
  subLine: (lang: 'en' | 'ur') => string;
  CHIPS: { id: string; label: Pair }[];
  CARD: Record<string, any>;
  STEPS: { title: Pair; body: Pair }[];
  honestyLine: (lang: 'en' | 'ur') => string;
};

const ALL_TEXT = JSON.stringify([
  copy.HEADLINE,
  copy.CHIPS,
  copy.CARD,
  copy.STEPS,
  copy.subLine('en'),
  copy.subLine('ur'),
  copy.honestyLine('en'),
  copy.honestyLine('ur'),
]);

describe('the headline', () => {
  it('is "Before you launch: what can a stranger reach?", 8 words, so its timing is unchanged', () => {
    expect(copy.HEADLINE.en).toBe(
      'Before you launch: what can a stranger reach?',
    );
    expect(copy.headlineWords('en')).toHaveLength(8);
  });

  it('has the Roman Urdu version', () => {
    expect(copy.HEADLINE.ur).toBe(
      'Launch se pehle: ek ajnabi aap ki app mein kahan tak pahunch sakta hai?',
    );
  });

  it('the page gives the words one after the other, 90 ms apart, from 150 ms (as before)', () => {
    const page = read('app', 'page.tsx');
    expect(page).toContain('animationDelay: `${150 + index * 90}ms`');
    expect(page).toContain('aria-label={HEADLINE_TEXT}');
    // a long Roman Urdu headline gets a smaller size
    expect(page).toContain('hero-title hero-title-ur');
  });
});

describe('the three chips: the two groups of the Connect form, and both', () => {
  it('are Website, Supabase and Both, with a Roman Urdu name', () => {
    expect(copy.CHIPS.map((c) => c.label.en)).toEqual([
      'Website',
      'Supabase',
      'Both',
    ]);
    expect(copy.CHIPS.map((c) => c.id)).toEqual([
      'website',
      'supabase',
      'both',
    ]);
    expect(copy.CHIPS[2].label.ur).toBe('Dono');
  });

  it('point at the fields of the two groups, which have those ids', () => {
    const page = read('app', 'page.tsx');
    expect(page).toContain("'project-url' : 'website-url'");
    const groups = read('components', 'connect-groups.tsx');
    expect(groups).toContain('id="website-url"');
    expect(groups).toContain('id="project-url"');
    // they sit under the sub-line
    expect(page.indexOf('subLine(lang)')).toBeLessThan(
      page.indexOf('hero-chips'),
    );
  });
});

describe('the example run card', () => {
  const card = read('components', 'hero-card.tsx');

  it('has three evidence rows: site headers (amber), scripts of the site (red), table data (green)', () => {
    expect(copy.CARD.headers.label.en).toBe('Site headers');
    expect(copy.CARD.scripts.label.en).toBe('Scripts of the site');
    expect(copy.CARD.tables.label.en).toBe('Table data');
    expect(card).toMatch(/tone="warn"/);
    expect(card).toMatch(/tone="leak"/);
    expect(card).toMatch(/tone="ok"/);
    expect(card).toContain('<VerdictBadge verdict="LEAKED"');
    expect(card).toContain('<VerdictBadge verdict="BLOCKED"');
  });

  it('two headers are missing, in both languages', () => {
    expect(copy.CARD.headers.result.en).toBe('2 missing');
    expect(copy.CARD.headers.detail.en).toContain('2 of 6');
    expect(copy.CARD.headers.detail.ur).toContain('6 mein se 2');
  });

  it('the key is masked, and no real key is anywhere in the hero', () => {
    expect(copy.CARD.scripts.key).toBe('sb_secret_••••');
    for (const file of [
      read('lib', 'hero-copy.ts'),
      card,
      read('app', 'hero.css'),
    ]) {
      expect(file).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9]/);
      expect(file).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    }
  });

  it('ends with a gate line: "Not ready by these checks", one reason, one "Not provided" chip', () => {
    expect(copy.CARD.gate.label.en).toBe('Not ready by these checks');
    expect(copy.CARD.gate.reason.en).toBe(
      'A secret key is in a script of the site.',
    );
    expect(copy.CARD.gate.notProvided.en).toMatch(/^Not provided: /);
    expect(copy.CARD.gate.notProvided.ur).toMatch(/^Diya nahi gaya: /);
    expect(card.indexOf('hero-rows')).toBeLessThan(
      card.indexOf('hero-gate-line'),
    );
  });

  it('says it is an example, with made-up numbers', () => {
    expect(copy.CARD.tag.en).toBe('Example run');
    expect(copy.CARD.tagNote.en).toBe('Made-up numbers');
  });

  it('every text has English and Roman Urdu', () => {
    const walk = (value: unknown, path: string) => {
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.en === 'string') {
          expect(String(record.ur ?? ''), path).not.toBe('');
          return;
        }
        for (const [k, v] of Object.entries(record)) walk(v, `${path}.${k}`);
      }
    };
    walk(copy.CARD, 'CARD');
    walk(copy.STEPS, 'STEPS');
    walk(copy.CHIPS, 'CHIPS');
  });

  it('is resolved by the scan beam of the intro, top to bottom, over the three rows', () => {
    expect(card).toContain("import { ScanBeam } from './scan-beam'");
    expect(card).toContain('<ScanBeam');
    expect(card).toContain('axis="y"');
    // each row shows its result when the beam has passed it (--at), the gate after
    expect(card).toContain("'--at': resolveAt");
    expect(card).toContain('hero-gate-line');
    const css = read('app', 'hero.css');
    expect(css).toMatch(
      /\.hero-result \{[^}]*animation: heroResolve[^}]*var\(--at/,
    );
    expect(css).toMatch(
      /\.hero-gate-line \{[^}]*animation: heroResolve[^}]*var\(--at/,
    );
  });

  it('the beam reaches the rows in order: headers, scripts, tables, then the gate', () => {
    const times = [
      ...card.matchAll(/(headers|scripts|tables|gate): (?:at\((\d+)\)|`)/g),
    ];
    expect(times.length).toBeGreaterThanOrEqual(3);
    const at = (name: string) =>
      Number(card.match(new RegExp(name + ': at\\((\\d+)\\)'))?.[1]);
    expect(at('headers')).toBeLessThan(at('scripts'));
    expect(at('scripts')).toBeLessThan(at('tables'));
  });

  it('waits for the intro like the headline: paused while the intro runs, then it starts', () => {
    const css = read('app', 'hero.css');
    expect(css).toMatch(
      /html\[data-intro="pending"\] \.hero-card,\s*html\[data-intro="pending"\] \.hero-card \*,\s*html\[data-intro="leaving"\] \.hero-card,\s*html\[data-intro="leaving"\] \.hero-card \* \{\s*animation-play-state: paused/,
    );
    expect(css).not.toMatch(/data-intro="opening"\] \.hero-card/);
  });

  it('with reduced motion it is the final state, no motion', () => {
    const css = read('app', 'hero.css');
    const block = css.slice(
      css.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(block).toMatch(
      /\.hero-result,\s*\.hero-gate-line \{\s*opacity: 1;\s*animation: none/,
    );
    expect(block).toMatch(/\.hero-row::before \{\s*animation: none/);
    expect(block).toContain('.hero-beam-layer');
  });

  it('on a phone (480 px and narrower) it is four compact rows, with no diagram and no beam', () => {
    const css = read('app', 'hero.css');
    const block = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(block).toMatch(
      /\.hero-beam-layer,\s*\.hero-mini,\s*\.hero-wait,\s*\.hero-row-detail \{\s*display: none/,
    );
    expect(block).toMatch(
      /\.hero-result,\s*\.hero-gate-line \{\s*opacity: 1;\s*animation: none/,
    );
    // the card is never hidden any more (it was, under 980 px)
    expect(css).not.toMatch(/\.hero-card(-wrap)? \{[^}]*display: none/);
    expect(read('components', 'hero-card.tsx').match(/<Row\b/g)?.length).toBe(
      3,
    );
  });

  it('the canary scene is made small: three tries, a policy line, one canary row', () => {
    expect(card).toContain('hero-mini-policy');
    expect(card).toContain('hero-mini-canary');
    expect(card).toContain('[8, 23, 38].map');
  });
});

describe('the three steps and the honesty line', () => {
  it('Connect, Checks run, Gate and roadmap', () => {
    expect(copy.STEPS.map((s) => s.title.en)).toEqual([
      'Connect',
      'Checks run',
      'Gate and roadmap',
    ]);
    const page = read('app', 'page.tsx');
    expect(page.indexOf('hero-card-wrap')).toBeLessThan(
      page.indexOf('hero-steps'),
    );
    expect(page.indexOf('hero-steps')).toBeLessThan(
      page.indexOf('connect-grid'),
    );
  });

  it('one honesty line, in both languages, about the listed checks and the scope', () => {
    expect(copy.honestyLine('en')).toBe(
      'Gatecheck only runs the listed checks, and every report shows its scope.',
    );
    expect(copy.honestyLine('ur')).toBe(
      'Gatecheck sirf wohi checks chalata hai jo list mein hain, aur har report apna scope dikhati hai.',
    );
    expect(read('app', 'page.tsx')).toContain('honestyLine(lang)');
  });

  it('the name comes from PROJECT_NAME, not from a word in the hero', () => {
    expect(read('lib', 'hero-copy.ts')).toContain(
      "import { PROJECT_NAME } from './brand'",
    );
    expect(read('lib', 'hero-copy.ts')).not.toMatch(/'[^']*Gatecheck/);
  });
});

describe('the words of the hero', () => {
  it('never claim safety or approval: no safe, secure, certified or guaranteed, no MCP or Jira', () => {
    expect(ALL_TEXT).not.toMatch(
      /\b(safe|safely|secure|secured|certified|certificate|guarantee[ds]?|mcp|jira|mehfooz|surakshit|zamanat)\b/i,
    );
  });

  it('say "by these checks" where the gate speaks', () => {
    expect(copy.CARD.gate.label.en).toContain('by these checks');
    expect(copy.STEPS[2].body.en).toContain('by these checks');
  });
});
