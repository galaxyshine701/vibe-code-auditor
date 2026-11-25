import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The words of the one start button, and the "Will check" line under it, are
// built from what is filled in: only the repository, only the website, both, or
// anything in the Supabase part. When the start is possible the line names
// exactly what the request sends.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
type Lang = 'en' | 'ur';
type Fields = Record<string, unknown>;
const form = (await import(
  /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'form.ts')).href
)) as {
  EMPTY_FIELDS: Fields;
  checkConnect: (f: never) => { canStart: boolean };
  buildStartBody: (f: never) => Record<string, unknown>;
  startButtonLabel: (c: never, lang?: Lang) => string;
  willCheckLine: (c: never, lang?: Lang) => string;
};

const REPO = { repoUrl: 'https://github.com/example-owner/shop', confirmRepoAccess: true };
const SITE = { websiteUrl: 'https://www.example-shop.com', confirmSiteAccess: true };
const DB = {
  projectUrl: 'https://abcdefgh.supabase.co',
  anonKey: 'a',
  serviceKey: 'b',
  confirmTestProject: true,
};
const fields = (...parts: Fields[]) =>
  Object.assign({}, form.EMPTY_FIELDS, ...parts) as never;
const check = (...parts: Fields[]) => form.checkConnect(fields(...parts)) as never;

const CASES: [string, Fields[], string, string, string][] = [
  ['nothing', [], 'Check this repo', 'Ye repo check karein', ''],
  ['only a repository', [REPO], 'Check this repo', 'Ye repo check karein', 'repo'],
  ['only a website', [SITE], 'Check website', 'Website check karein', 'website'],
  ['both', [REPO, SITE], 'Check repo + website', 'Repo + website check karein', 'repo + website'],
  ['only Supabase', [DB], 'Run these checks', 'Ye checks chalayein', 'Supabase test project'],
  ['Supabase with a repository', [REPO, DB], 'Run these checks', 'Ye checks chalayein', 'repo + Supabase test project'],
  ['all three', [REPO, SITE, DB], 'Run these checks', 'Ye checks chalayein', 'repo + website + Supabase test project'],
];

describe('the button and the line, from what is filled in', () => {
  for (const [name, parts, en, ur, names] of CASES) {
    it(name, () => {
      expect(form.startButtonLabel(check(...parts))).toBe(en);
      expect(form.startButtonLabel(check(...parts), 'ur')).toBe(ur);
      expect(form.willCheckLine(check(...parts))).toBe(names ? `Will check: ${names}` : '');
      expect(form.willCheckLine(check(...parts), 'ur')).toBe(names ? `Ye check honge: ${names}` : '');
    });
  }

  it('a half-filled group already counts, and the start still waits for it', () => {
    const typed = { websiteUrl: SITE.websiteUrl };
    expect(form.startButtonLabel(check(typed))).toBe('Check website');
    expect(form.startButtonLabel(check(REPO, typed))).toBe('Check repo + website');
    expect(form.willCheckLine(check(REPO, typed))).toBe('Will check: repo + website');
    expect(form.checkConnect(fields(REPO, typed)).canStart).toBe(false);
    expect(form.startButtonLabel(check({ projectUrl: DB.projectUrl }))).toBe('Run these checks');
  });

  it('when the start is possible, the line names exactly what is sent', () => {
    for (const [, parts] of CASES) {
      if (!form.checkConnect(fields(...parts)).canStart) continue;
      const body = form.buildStartBody(fields(...parts));
      const line = form.willCheckLine(check(...parts));
      expect(line.includes('repo')).toBe('repoUrl' in body);
      expect(line.includes('website')).toBe('websiteUrl' in body);
      expect(line.includes('Supabase')).toBe('projectUrl' in body);
    }
  });
});
