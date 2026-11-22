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
  PROBLEM: Pair;
  WHAT_IT_DOES: { id: string; title: Pair; body: Pair }[];
  CHIP_TARGET: Record<string, { field: string; group: number | null }>;
  CHIPS: { id: string; label: Pair }[];
  CARD: Record<string, any>;
  STEPS: { title: Pair; body: Pair }[];
  honestyLine: (lang: 'en' | 'ur') => string;
};

const ALL_TEXT = JSON.stringify([
  copy.HEADLINE,
  copy.PROBLEM,
  copy.WHAT_IT_DOES,
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

describe('the lede: the problem first, then what Gatecheck is', () => {
  it('starts with the problem, in one plain sentence, in both languages', () => {
    expect(copy.PROBLEM.en).toBe(
      'An app built with AI tools can go live with its database or keys open to anyone.',
    );
    expect(copy.PROBLEM.ur.length).toBeGreaterThan(20);
    expect(copy.PROBLEM.ur).toContain('AI tools');
    // no statistics: no digit, no percent
    expect(copy.PROBLEM.en + copy.PROBLEM.ur).not.toMatch(/\d|%/);
  });

  it('then says what it checks and what it gives: a gate result, by these checks, with the evidence', () => {
    expect(copy.subLine('en')).toBe(
      'Gatecheck checks a live site, a Supabase project and a public GitHub repo, then gives one gate result, by these checks, with the evidence.',
    );
    expect(copy.subLine('ur')).toContain('Gatecheck ek live site');
    expect(copy.subLine('ur')).toContain('public GitHub repo');
    expect(copy.subLine('ur')).toContain('in checks ke hisaab se');
    expect(copy.subLine('ur')).toContain('saboot');
  });

  it('is shown in this order: problem, lede, four lines, chips', () => {
    const page = read('app', 'page.tsx');
    const at = (text: string) => page.indexOf(text);
    expect(at('hero-problem')).toBeGreaterThan(-1);
    expect(at('hero-problem')).toBeLessThan(at('subLine(lang)'));
    expect(at('subLine(lang)')).toBeLessThan(at('hero-does'));
    expect(at('hero-does')).toBeLessThan(at('hero-chips'));
    expect(page).toContain('pickText(PROBLEM, lang)');
  });
});

describe('the four lines of what it does', () => {
  it('say plainly: a live site, Supabase tables by replaying two test users (RLS), a public GitHub repo, and a gate with evidence', () => {
    expect(copy.WHAT_IT_DOES.map((l) => l.id)).toEqual([
      'site',
      'supabase',
      'repo',
      'gate',
    ]);
    const by = (id: string) => copy.WHAT_IT_DOES.find((l) => l.id === id)!;
    expect(by('site').body.en).toContain('headers');
    expect(by('site').body.en).toContain('scripts');
    expect(by('supabase').body.en).toContain('two test users');
    expect(by('supabase').body.en).toContain('row level security (RLS)');
    expect(by('repo').body.en).toContain('secret keys');
    expect(by('repo').body.en).toContain('no RLS');
    expect(by('gate').body.en).toContain('by these checks');
    expect(by('gate').body.en).toContain('evidence');
    expect(by('gate').body.ur).toMatch(/in checks ke hisaab se/i);
  });

  it('every line has English and Roman Urdu', () => {
    for (const line of copy.WHAT_IT_DOES) {
      expect(line.title.en).not.toBe('');
      expect(line.title.ur).not.toBe('');
      expect(line.body.en.length).toBeGreaterThan(20);
      expect(line.body.ur.length).toBeGreaterThan(20);
    }
  });
});

describe('the four chips: the three groups of the Connect form, and all', () => {
  it('are Website, Supabase, GitHub repo and All, with a Roman Urdu name', () => {
    expect(copy.CHIPS.map((c) => c.label.en)).toEqual([
      'Website',
      'Supabase',
      'GitHub repo',
      'All',
    ]);
    expect(copy.CHIPS.map((c) => c.id)).toEqual([
      'website',
      'supabase',
      'repo',
      'all',
    ]);
    expect(copy.CHIPS[3].label.ur).toBe('Sab');
  });

  it('there are exactly 4 chips, and "Both" is nowhere in the hero (copy, targets, styles, page)', () => {
    expect(copy.CHIPS).toHaveLength(4);
    expect(Object.keys(copy.CHIP_TARGET).sort()).toEqual(
      ['all', 'repo', 'supabase', 'website'],
    );
    for (const file of [
      read('lib', 'hero-copy.ts'),
      read('app', 'hero.css'),
      read('app', 'page.tsx'),
    ]) {
      expect(file).not.toMatch(/\bBoth\b|data-chip="both"|id: 'both'|'both'|\bDono\b/);
    }
  });

  it('point at the first field of their group, which has that id; All points at every group', () => {
    expect(copy.CHIP_TARGET).toEqual({
      website: { field: 'website-url', group: 0 },
      supabase: { field: 'project-url', group: 1 },
      repo: { field: 'repo-url', group: 2 },
      all: { field: 'website-url', group: null },
    });
    const page = read('app', 'page.tsx');
    expect(page).toContain('CHIP_TARGET[chip]');
    expect(page).toContain('target.group === null');
    const groups = read('components', 'connect-groups.tsx');
    for (const target of Object.values(copy.CHIP_TARGET)) {
      expect(groups).toContain(`id="${target.field}"`);
    }
    // the groups are in the order website, Supabase, repo
    const order = ['website-url', 'project-url', 'repo-url'].map((id) =>
      groups.indexOf(`id="${id}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // they sit under the sub-line
    expect(page.indexOf('subLine(lang)')).toBeLessThan(
      page.indexOf('hero-chips'),
    );
  });
});

describe('the example run card', () => {
  const card = read('components', 'hero-card.tsx');

  it('has four evidence rows: site headers (amber), scripts of the site (red), table data (green), repository files (amber, INCONCLUSIVE)', () => {
    expect(copy.CARD.headers.label.en).toBe('Site headers');
    expect(copy.CARD.scripts.label.en).toBe('Scripts of the site');
    expect(copy.CARD.tables.label.en).toBe('Table data');
    expect(copy.CARD.repo.label.en).toBe('Repository files');
    expect(copy.CARD.repo.label.ur).toBe('Repository ki files');
    expect(copy.CARD.repo.detail.en).toContain('no row level security');
    expect(copy.CARD.repo.detail.en).toContain('may be enabled elsewhere');
    expect(card.match(/tone="warn"/g)).toHaveLength(2);
    expect(card).toMatch(/tone="leak"/);
    expect(card).toMatch(/tone="ok"/);
    expect(card).toContain('<VerdictBadge verdict="LEAKED"');
    expect(card).toContain('<VerdictBadge verdict="BLOCKED"');
    expect(card).toContain('<VerdictBadge verdict="INCONCLUSIVE"');
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

  it('says "Example, not a real audit" in English and Roman Urdu, with made-up numbers, in the card head and its label', () => {
    expect(copy.CARD.tag.en).toBe('Example, not a real audit');
    expect(copy.CARD.tag.ur).toBe('Misaal, asli audit nahi');
    expect(copy.CARD.tagNote.en).toBe('Made-up numbers');
    expect(copy.CARD.tagNote.ur).toBe('Farzi ankre');
    // the tag is the visible head of the card and also its accessible name
    expect(card).toContain('aria-label={pickText(CARD.tag, lang)}');
    expect(card.indexOf('hero-card-tag')).toBeLessThan(card.indexOf('hero-rows'));
    expect(card).toContain('{pickText(CARD.tag, lang)}</span>');
    // it is not hidden on a phone
    const css = read('app', 'hero.css');
    expect(css).not.toMatch(/\.hero-card-(tag|head|note)[^{]*\{[^}]*display: none/);
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
    walk(copy.WHAT_IT_DOES, 'WHAT_IT_DOES');
    walk(copy.PROBLEM, 'PROBLEM');
  });

  it('is resolved by the scan beam of the intro, top to bottom, over the four rows', () => {
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

  it('the beam reaches the rows in order: headers, scripts, tables, repository, then the gate', () => {
    const times = [
      ...card.matchAll(/(headers|scripts|tables|repo|gate): (?:at\((\d+)\)|`)/g),
    ];
    expect(times.length).toBeGreaterThanOrEqual(4);
    const at = (name: string) =>
      Number(card.match(new RegExp(name + ': at\\((\\d+)\\)'))?.[1]);
    expect(at('headers')).toBeLessThan(at('scripts'));
    expect(at('scripts')).toBeLessThan(at('tables'));
    expect(at('tables')).toBeLessThan(at('repo'));
    expect(at('repo')).toBeLessThan(108); // inside the beam's path
    // the rows are in the markup in the same order
    const rowAt = (text: string) => card.indexOf(`resolveAt={T.${text}}`);
    expect(rowAt('headers')).toBeLessThan(rowAt('scripts'));
    expect(rowAt('scripts')).toBeLessThan(rowAt('tables'));
    expect(rowAt('tables')).toBeLessThan(rowAt('repo'));
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
      4,
    );
  });

  it('at 375 px the four lines of what it does stack (title above its text), and the four chips wrap', () => {
    const css = read('app', 'hero.css');
    const block = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(block).toMatch(
      /\.hero-does li \{\s*grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(/\.hero-chips \{[^}]*flex-wrap: wrap/);
    // no fixed width wider than a phone in the hero rules
    expect(css).not.toMatch(/(?<![\w-])(?:min-)?width: (?:[4-9]\d\d|\d{4,})px/);
    // long words (Roman Urdu) wrap instead of pushing the page sideways
    expect(css).toMatch(/\.hero-does span \{[^}]*overflow-wrap: break-word/);
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
