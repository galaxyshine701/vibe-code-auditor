import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// VCA-H9, the activity strip of the run page: one chip for each module the
// backend sent, with the name and the status the backend gave, in a fixed order.
// Nothing is made up: no step, no file, no "reading files".
const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'frontend', 'src');
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');

type Mod = { id: string; name: string; status: string; progress: number };
const rows = (await import(
  /* @vite-ignore */ pathToFileURL(join(SRC, 'lib', 'progress-rows.ts')).href
)) as {
  activityOrder: (m: Mod[] | null | undefined) => Mod[];
  activityText: (m: Mod, lang: 'en' | 'ur') => string;
  runningNow: (m: Mod[] | null | undefined) => string[];
};

const mod = (id: string, name: string, status: string): Mod => ({ id, name, status, progress: 0 });
const ids = (list: Mod[]) => list.map((m) => m.id);

describe('the order of the strip', () => {
  it('the repo-only example: Planner, Repo scan, Evidence, Roadmap, Guide, then the skipped ones', () => {
    const audit = JSON.parse(
      readFileSync(join(ROOT, 'docs', 'frontend-mock', 'repo-only', 'audit.json'), 'utf8'),
    ) as { modules: Mod[] };
    expect(ids(rows.activityOrder(audit.modules))).toEqual([
      'planner',
      'repo-secrets',
      'evidence',
      'roadmap',
      'guide',
      'data-access-prover',
      'ownership',
    ]);
  });

  it('with a website too: Planner, Repo scan, Site headers, Bundle scan, Evidence, Roadmap, Guide', () => {
    const list = [
      mod('guide', 'Guide', 'queued'),
      mod('roadmap', 'Roadmap', 'queued'),
      mod('evidence', 'Evidence', 'queued'),
      mod('bundle-secrets', 'Bundle scan', 'running'),
      mod('tls-headers', 'Site headers', 'completed'),
      mod('repo-secrets', 'Repo scan', 'running'),
      mod('planner', 'Planner', 'completed'),
    ];
    expect(ids(rows.activityOrder(list))).toEqual([
      'planner',
      'repo-secrets',
      'tls-headers',
      'bundle-secrets',
      'evidence',
      'roadmap',
      'guide',
    ]);
  });

  it('a module that is not in the list (the Prover, the Report agent) comes after Guide, and a skipped one is always last, even a named one', () => {
    const list = [
      mod('planner', 'Planner', 'completed'),
      mod('repo-secrets', 'Repo scan', 'skipped'),
      mod('data-access-prover', 'Data Access Prover', 'running'),
      mod('guide', 'Guide', 'queued'),
      mod('report', 'Report agent', 'queued'),
      mod('ownership', 'Ownership', 'skipped'),
    ];
    expect(ids(rows.activityOrder(list))).toEqual([
      'planner',
      'guide',
      'data-access-prover',
      'report',
      'repo-secrets',
      'ownership',
    ]);
  });

  it('keeps every module once, changes none, and does not change the list it was given', () => {
    const list = [mod('b', 'B', 'queued'), mod('a', 'A', 'skipped'), mod('planner', 'Planner', 'running')];
    const before = JSON.stringify(list);
    const out = rows.activityOrder(list);
    expect(out).toHaveLength(3);
    expect(JSON.stringify(list)).toBe(before);
    expect(out.find((m) => m.id === 'a')).toBe(list[1]);
    expect(rows.activityOrder(undefined)).toEqual([]);
    expect(rows.activityOrder(null)).toEqual([]);
  });
});

describe("the words of a chip are the backend's", () => {
  it('is "name: status", with the status the backend gave', () => {
    expect(rows.activityText(mod('repo-secrets', 'Repo scan', 'running'), 'en')).toBe('Repo scan: running');
    expect(rows.activityText(mod('planner', 'Planner', 'completed'), 'en')).toBe('Planner: completed');
    expect(rows.activityText(mod('ownership', 'Ownership', 'skipped'), 'en')).toBe('Ownership: skipped');
    expect(rows.activityText(mod('x', 'Guide', 'failed'), 'en')).toBe('Guide: failed');
    // a status the page does not know is shown as given, never a crash
    expect(rows.activityText(mod('x', 'Guide', 'TIMEOUT'), 'en')).toBe('Guide: timeout');
  });

  it('"Running now" names only the modules that are running', () => {
    const list = [
      mod('planner', 'Planner', 'completed'),
      mod('repo-secrets', 'Repo scan', 'running'),
      mod('tls-headers', 'Site headers', 'running'),
      mod('guide', 'Guide', 'queued'),
    ];
    expect(rows.runningNow(list)).toEqual(['Repo scan', 'Site headers']);
    expect(rows.runningNow([mod('planner', 'Planner', 'completed')])).toEqual([]);
    expect(rows.runningNow(undefined)).toEqual([]);
  });

  it('never says "reading files", or any step or count the backend does not send', () => {
    for (const text of [
      read('lib', 'progress-rows.ts'),
      read('app', 'audits', '[id]', 'page.tsx'),
    ]) {
      expect(text).not.toMatch(/reading files|reads? files|files? read|files? scanned|\bchose\b/i);
    }
  });
});

describe('the page and the styles', () => {
  const page = read('app', 'audits', '[id]', 'page.tsx');
  const css = read('app', 'stage.css');

  it('shows the strip above the rows, from audit.modules in the order of activityOrder', () => {
    expect(page).toContain('activityOrder(asked)');
    expect(page.indexOf('className="activity-strip"')).toBeLessThan(
      page.indexOf('className="module-list"'),
    );
    expect(page).toContain('activityText(module, lang)');
    // the rows keep the order received (R75)
    expect(page).toContain('detailed.map((module, index)');
  });

  it('says what is running from the modules that are running, as a status message', () => {
    expect(page).toContain('runningNow(audit.modules)');
    expect(page).toMatch(/role="status">\s*Running now:/);
  });

  it('each chip says its status in words (never colour alone); a skipped one is also dashed', () => {
    expect(css).toMatch(/\.activity-skipped \{[^}]*border-style: dashed/);
    for (const tone of ['completed', 'failed', 'running', 'skipped']) {
      expect(css).toContain(`.activity-${tone}`);
    }
  });

  it('the pulse of a running chip stops with reduced motion, and moves only opacity', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.activity-running \.activity-dot \{\s*animation: none;/,
    );
    const body = /@keyframes activityPulse \{([\s\S]*?)\n\}\n/.exec(css)![1];
    expect([...body.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1])).toEqual(['opacity', 'opacity']);
  });
});
