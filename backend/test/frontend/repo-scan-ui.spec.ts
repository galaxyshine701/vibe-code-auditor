import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The frontend of Repo Scan Lite (A1): the third group of the Connect form, the
// label of the check, the "Repository files" evidence, the roadmap kind labels,
// the "Secrets in repo" tile, and the repo-only mock bundle. The frontend has no
// test runner of its own, so its files are loaded by path (as the other specs do).
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'frontend-mock');
const lib = (name: string) =>
  pathToFileURL(join(FRONTEND, 'src', 'lib', name)).href;
const read = (...parts: string[]) =>
  readFileSync(join(FRONTEND, 'src', ...parts), 'utf8');

interface Fields {
  label: string;
  websiteUrl: string;
  confirmSiteAccess: boolean;
  projectUrl: string;
  anonKey: string;
  serviceKey: string;
  confirmTestProject: boolean;
  repoUrl: string;
  confirmRepoAccess: boolean;
}
interface Group {
  state: 'empty' | 'partial' | 'complete';
  missing: string[];
}
const form = (await import(/* @vite-ignore */ lib('form.ts'))) as {
  EMPTY_FIELDS: Fields;
  checkConnect: (f: Fields) => {
    website: Group;
    supabase: Group;
    repo: Group;
    canStart: boolean;
  };
  buildStartBody: (f: Fields) => Record<string, unknown>;
  startNote: (c: ReturnType<typeof form.checkConnect>) => string;
  startHintOf: (c: ReturnType<typeof form.checkConnect>, code: boolean) => string;
};
const labels = (await import(/* @vite-ignore */ lib('check-labels.ts'))) as {
  checkLabel: (id: string, lang: 'en' | 'ur') => string;
};
const copy = (await import(/* @vite-ignore */ lib('stage-copy.ts'))) as {
  t: (lang: 'en' | 'ur', key: string) => string;
  kindLabel: (kind: string, lang: 'en' | 'ur') => string;
};
const stage = (await import(/* @vite-ignore */ lib('stage.ts'))) as {
  leakCount: (summary: unknown) => number;
  groupEvidence: (items: unknown) => { kind: string; items: unknown[] }[];
  noTableCheck: (audit: unknown) => boolean;
  showsRequiredLabel: (item: { kind: string; fromRequiredCheck?: boolean }) => boolean;
  headlineOf: (a: unknown, r: unknown) => { text: { en: string }; tone: string } | null;
  bucketsOf: (r: unknown, c: unknown, p?: unknown) => { checked: { id: string }[] } | null;
};
const rows = (await import(/* @vite-ignore */ lib('progress-rows.ts'))) as {
  targetLines: (t: unknown) => { kind: string; url: string }[];
};

const fields = (...parts: Partial<Fields>[]): Fields =>
  Object.assign({}, form.EMPTY_FIELDS, ...parts);
const REPO: Partial<Fields> = {
  repoUrl: 'https://github.com/example-owner/example-shop',
  confirmRepoAccess: true,
};
const WEBSITE: Partial<Fields> = {
  websiteUrl: 'https://www.example-shop.com',
  confirmSiteAccess: true,
};
const SUPABASE: Partial<Fields> = {
  projectUrl: 'https://example-project.supabase.co',
  anonKey: 'PUBLISHABLE-PLACEHOLDER',
  serviceKey: 'SECRET-PLACEHOLDER',
  confirmTestProject: true,
};

const json = (...parts: string[]) =>
  JSON.parse(readFileSync(join(...parts), 'utf8')) as Record<string, any>;
const bundle = () => ({
  audit: json(DOCS, 'repo-only', 'audit.json'),
  evidence: json(DOCS, 'repo-only', 'evidence.json'),
  roadmap: json(DOCS, 'repo-only', 'roadmap.json'),
  clientReport: json(DOCS, 'repo-only', 'client-report.json'),
});

describe('the Connect form: the third group', () => {
  it('a fresh form has an empty repo group and cannot start', () => {
    const check = form.checkConnect(fields());
    expect(check.repo).toEqual({ state: 'empty', missing: [] });
    expect(check.canStart).toBe(false);
  });

  it('the repo group alone is enough to start', () => {
    const check = form.checkConnect(fields(REPO));
    expect(check.repo.state).toBe('complete');
    expect(check.canStart).toBe(true);
  });

  it('a half-filled repo group blocks the start and names what is missing', () => {
    const noBox = form.checkConnect(fields({ repoUrl: 'https://github.com/a/b' }));
    expect(noBox.repo.state).toBe('partial');
    expect(noBox.repo.missing).toEqual([
      'the box "This repository is public and I may scan its files"',
    ]);
    expect(noBox.canStart).toBe(false);
    const noUrl = form.checkConnect(fields({ confirmRepoAccess: true }));
    expect(noUrl.repo.missing).toEqual(['Repository address']);
    expect(noUrl.canStart).toBe(false);
    // a blank address counts as nothing
    expect(form.checkConnect(fields({ repoUrl: '   ' })).repo.state).toBe('empty');
  });

  it('a complete group does not hide a half-filled one', () => {
    const check = form.checkConnect(
      fields(WEBSITE, { repoUrl: 'https://github.com/a/b' }),
    );
    expect(check.canStart).toBe(false);
    expect(form.startNote(check)).toBe(
      'Finish or clear a group: Repository: the box "This repository is public and I may scan its files".',
    );
  });

  it('any one or more complete groups can start', () => {
    for (const parts of [[WEBSITE], [SUPABASE], [REPO], [WEBSITE, REPO], [SUPABASE, REPO], [WEBSITE, SUPABASE, REPO]]) {
      expect(form.checkConnect(fields(...parts)).canStart).toBe(true);
    }
  });

  it('the hint names the repo box first (it is the first box of the page), and never a value', () => {
    const hint = form.startHintOf(form.checkConnect(fields()), false);
    expect(hint).toBe(
      'To start: enter the access code. Paste a public GitHub repo link and tick the box "This repository is public and I may scan its files", or add a live website.',
    );
    const partial = form.startHintOf(
      form.checkConnect(fields({ repoUrl: 'https://github.com/SECRET-OWNER/b' })),
      true,
    );
    expect(partial).not.toContain('SECRET-OWNER');
  });
});

describe('the request body', () => {
  it('has repoUrl and confirmRepoAccess only when the group is complete', () => {
    expect(form.buildStartBody(fields(REPO))).toEqual({
      repoUrl: 'https://github.com/example-owner/example-shop',
      confirmRepoAccess: true,
    });
    // an unticked or empty group sends nothing about it
    for (const parts of [
      [{ repoUrl: 'https://github.com/a/b' }],
      [{ confirmRepoAccess: true }],
      [],
    ]) {
      const body = form.buildStartBody(fields(WEBSITE, ...parts));
      expect(body).not.toHaveProperty('repoUrl');
      expect(body).not.toHaveProperty('confirmRepoAccess');
    }
  });

  it('old bodies are exactly as before (no new key at all)', () => {
    expect(Object.keys(form.buildStartBody(fields(WEBSITE))).sort()).toEqual([
      'confirmSiteAccess',
      'websiteUrl',
    ]);
    expect(Object.keys(form.buildStartBody(fields(SUPABASE))).sort()).toEqual([
      'anonKey',
      'confirmTestProject',
      'projectUrl',
      'serviceKey',
    ]);
  });

  it('is the one in docs/frontend-mock/repo-only/request.json, and with other groups it adds to them', () => {
    const expected = json(DOCS, 'repo-only', 'request.json');
    expect(
      form.buildStartBody(fields({ label: 'Example shop (code)' }, REPO)),
    ).toEqual(expected);
    expect(form.buildStartBody(fields(WEBSITE, REPO))).toEqual({
      websiteUrl: 'https://www.example-shop.com',
      confirmSiteAccess: true,
      repoUrl: 'https://github.com/example-owner/example-shop',
      confirmRepoAccess: true,
    });
  });
});

describe('words: labels and kinds (EN and Roman Urdu)', () => {
  it('the check is "Repo scan"', () => {
    expect(labels.checkLabel('repo-secrets', 'en')).toBe('Repo scan');
    expect(labels.checkLabel('repo-secrets', 'ur')).toBe('Repo ka scan');
  });

  it('the roadmap kinds have labels in both languages', () => {
    for (const kind of ['fix-repo-secret', 'improve-repo']) {
      expect(copy.kindLabel(kind, 'en')).not.toBe(kind);
      expect(copy.kindLabel(kind, 'ur')).not.toBe(kind);
    }
    expect(copy.kindLabel('fix-repo-secret', 'en')).toBe('Remove a secret key from the repo');
    // an unknown kind is still shown as given
    expect(copy.kindLabel('something-new', 'en')).toBe('something-new');
  });

  it('the summary tile and the evidence group', () => {
    expect(copy.t('en', 'repoKeys')).toBe('Secrets in repo');
    expect(copy.t('ur', 'repoKeys')).toBe('Repo mein secrets');
    expect(copy.t('en', 'kindRepo')).toBe('Repository files');
    expect(copy.t('ur', 'kindRepo')).toBe('Repository ki files');
  });

  it('none of the new words is one of the banned ones', () => {
    const banned = [/\bsafe(ly|ty)?\b/i, /\bsecure[ds]?\b/i, /\bcertifi(ed|cate)\b/i, /\bguarantee[ds]?\b/i, /\b(mehfooz|mahfooz|surakshit|zamanat)\b/i];
    const words = [
      ...['summaryRepo', 'repoKeys', 'kindRepo', 'repoKeyHidden'].flatMap((k) => [copy.t('en', k), copy.t('ur', k)]),
      ...['fix-repo-secret', 'improve-repo'].flatMap((k) => [copy.kindLabel(k, 'en'), copy.kindLabel(k, 'ur')]),
      labels.checkLabel('repo-secrets', 'en'),
      labels.checkLabel('repo-secrets', 'ur'),
      read('components', 'connect-groups.tsx'),
    ];
    for (const word of words) for (const pattern of banned) expect(word).not.toMatch(pattern);
  });
});

describe('the Report of the repo-only bundle', () => {
  it('the target has a repo line, and no table was checked', () => {
    const { audit } = bundle();
    expect(rows.targetLines(audit.target)).toEqual([
      { kind: 'repo', url: 'https://github.com/example-owner/example-shop' },
    ]);
    expect(stage.noTableCheck(audit)).toBe(true);
    // a website-only and a Supabase-only audit are as before
    expect(stage.noTableCheck({ target: { websiteUrl: 'https://x.example' } })).toBe(true);
    expect(stage.noTableCheck({ target: { projectUrl: 'https://p.supabase.co' } })).toBe(false);
  });

  it('a key in the repo is a leak: the count, and the headline', () => {
    const { audit, clientReport } = bundle();
    expect(stage.leakCount(audit.summary)).toBe(1);
    expect(stage.leakCount({ leaked: 1, siteLeaked: 2, repoLeaked: 3 })).toBe(6);
    expect(stage.leakCount({ leaked: 0, blocked: 4 })).toBe(0);
    const headline = stage.headlineOf(audit, clientReport);
    expect(headline?.tone).toBe('leak');
    expect(headline?.text.en).toMatch(/GitHub repository/);
  });

  it('the evidence is its own group, last, with path and line and no key', () => {
    const { evidence } = bundle();
    const groups = stage.groupEvidence([
      ...evidence.items,
      { id: 't', check: 'data-access-prover', verdict: 'BLOCKED' },
      { id: 'b', check: 'bundle-secrets', kind: 'site-bundle', verdict: 'LEAKED' },
    ]);
    // the three repo groups come last, in this order: a key, a variable name, a migration
    expect(groups.map((g) => g.kind)).toEqual([
      'table',
      'site-bundle',
      'repo-file',
      'repo-env-name',
      'repo-migration',
    ]);
    const name = evidence.items.find((i: { kind?: string }) => i.kind === 'repo-env-name');
    expect(name).toMatchObject({ subject: '.env.example', line: 2, verdict: 'INCONCLUSIVE' });
    const migration = evidence.items.find((i: { kind?: string }) => i.kind === 'repo-migration');
    expect(migration).toMatchObject({
      table: 'orders',
      subject: 'supabase/migrations/001_init.sql',
      line: 2,
      verdict: 'INCONCLUSIVE',
    });
    const item = evidence.items[0];
    expect(item).toMatchObject({ kind: 'repo-file', subject: 'src/lib/supabase.ts', line: 3, verdict: 'LEAKED' });
    expect(JSON.stringify(evidence)).not.toMatch(/sb_secret_[A-Za-z0-9_-]{16,}/);
    // the screen shows path:line and says the key is hidden
    const groupsFile = read('components', 'evidence-groups.tsx');
    expect(groupsFile).toContain("'repo-file': 'kindRepo'");
    expect(groupsFile).toContain("typeof item.line === 'number' ? `:${item.line}` : ''");
    expect(groupsFile).toContain("t(lang, 'repoKeyHidden')");
  });

  it('the repo check is in the scope as checked, and the roadmap kind is the new one', () => {
    const { audit, evidence, clientReport, roadmap } = bundle();
    const buckets = stage.bucketsOf(clientReport, evidence.coverage, audit.plan);
    expect(buckets?.checked.map((c) => c.id)).toContain('repo-secrets');
    expect(roadmap.items[0].kind).toBe('fix-repo-secret');
    expect(stage.showsRequiredLabel({ kind: 'fix-repo-secret', fromRequiredCheck: true })).toBe(true);
    expect(stage.showsRequiredLabel({ kind: 'improve-repo', fromRequiredCheck: true })).toBe(true);
    expect(stage.showsRequiredLabel({ kind: 'retest', fromRequiredCheck: true })).toBe(false);
  });

  it('the gate of a repo-only run shows its reasons through the banner (nothing hard-coded)', () => {
    const { audit } = bundle();
    expect(audit.gate.decision).toBe('not_ready');
    const banner = read('components', 'gate-banner.tsx');
    expect(banner).toContain('gate.reasons');
    // the page reads the new fields
    const report = read('app', 'audits', '[id]', 'report', 'page.tsx');
    expect(report).toContain('hasRepo={Boolean(audit?.target.repoUrl)}');
    expect(report).toContain('noTableCheck(audit)');
    const summary = read('components', 'client-summary.tsx');
    expect(summary).toContain("t(lang, 'repoKeys')");
  });
});

describe('the Connect form screen', () => {
  it('has the repo group with its box (the main box of the home page), and the hero names the repo too', () => {
    const groups = read('components', 'connect-groups.tsx');
    expect(groups).toContain('Public GitHub repo');
    expect(groups).toContain('This repository is public and I may scan its files.');
    // the repo is the one field of the hero: its group comes first
    expect(groups.indexOf('export function RepoGroup')).toBeLessThan(
      groups.indexOf('export function WebsiteGroup'),
    );
    // the first step of the page names the repo first
    expect(read('lib', 'hero-copy.ts')).toContain(
      'Paste the link of a public GitHub repo and tick the box. A live website is optional.',
    );
  });
});
