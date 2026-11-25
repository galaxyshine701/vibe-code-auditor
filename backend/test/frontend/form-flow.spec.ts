import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The flow of the home page: the access code in a small bar of the header, one
// repository field with its box and one button, a live website opened in place
// by a text link under the button, and the Supabase test project in a closed
// section at the bottom. The fields, the rules and the request are the ones
// there always were. The frontend has no test runner of its own, so its files
// are loaded or read by path.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const SRC = join(FRONTEND, 'src');
const requireFrontend = createRequire(join(FRONTEND, 'package.json'));
const React = requireFrontend('react') as typeof import('react');
const { renderToStaticMarkup } = requireFrontend(
  'react-dom/server',
) as typeof import('react-dom/server');
const href = (...parts: string[]) => pathToFileURL(join(SRC, ...parts)).href;
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');

type Lang = 'en' | 'ur';
type Fields = Record<string, unknown>;
const form = (await import(/* @vite-ignore */ href('lib', 'form.ts'))) as {
  EMPTY_FIELDS: Fields;
  checkConnect: (f: never) => { canStart: boolean };
  buildStartBody: (f: never) => Record<string, unknown>;
  willCheckLine: (c: never, lang?: Lang) => string;
  startButtonLabel: (c: never, websiteOpen: boolean, lang?: Lang) => string;
  startHintOf: (c: never, code: boolean, lang?: Lang) => string;
  startNote: (c: never, lang?: Lang) => string;
  repoUrlProblem: (v: string, lang?: Lang) => string;
};
const groups = (await import(
  /* @vite-ignore */ href('components', 'connect-groups.tsx')
)) as Record<string, unknown>;

const REPO = {
  repoUrl: 'https://github.com/example-owner/shop',
  confirmRepoAccess: true,
};
const WEBSITE = {
  websiteUrl: 'https://www.example-shop.com',
  confirmSiteAccess: true,
};
const SUPABASE = {
  projectUrl: 'https://abcdefgh.supabase.co',
  anonKey: 'a',
  serviceKey: 'b',
  confirmTestProject: true,
};
const checkOf = (...parts: Fields[]) =>
  form.checkConnect(Object.assign({}, form.EMPTY_FIELDS, ...parts) as never) as never;

function render(name: string, lang: Lang, patch: Fields = {}): string {
  const fields = { ...form.EMPTY_FIELDS, ...patch };
  return renderToStaticMarkup(
    React.createElement(groups[name] as never, {
      fields,
      check: form.checkConnect(fields as never),
      onChange: () => undefined,
      lang,
    }),
  );
}

describe('willCheckLine', () => {
  it('is empty while nothing is complete', () => {
    expect(form.willCheckLine(checkOf())).toBe('');
    expect(form.willCheckLine(checkOf({ repoUrl: REPO.repoUrl }))).toBe('');
    expect(form.willCheckLine(checkOf({ confirmSiteAccess: true }))).toBe('');
  });

  it('is built from the complete groups, repo first', () => {
    expect(form.willCheckLine(checkOf(REPO))).toBe('Will check: repo');
    expect(form.willCheckLine(checkOf(WEBSITE))).toBe('Will check: website');
    expect(form.willCheckLine(checkOf(WEBSITE, REPO))).toBe(
      'Will check: repo + website',
    );
    expect(form.willCheckLine(checkOf(SUPABASE, WEBSITE, REPO))).toBe(
      'Will check: repo + website + Supabase test project',
    );
  });

  it('leaves a half-filled group out', () => {
    expect(
      form.willCheckLine(checkOf(REPO, { websiteUrl: WEBSITE.websiteUrl })),
    ).toBe('Will check: repo');
  });

  it('names exactly what the request sends', () => {
    for (const parts of [[REPO], [WEBSITE], [REPO, WEBSITE], [REPO, SUPABASE]]) {
      const fields = Object.assign({}, form.EMPTY_FIELDS, ...parts);
      const body = form.buildStartBody(fields as never);
      const line = form.willCheckLine(form.checkConnect(fields as never) as never);
      expect(line.includes('repo')).toBe('repoUrl' in body);
      expect(line.includes('website')).toBe('websiteUrl' in body);
      expect(line.includes('Supabase')).toBe('projectUrl' in body);
    }
  });

  it('has Roman Urdu', () => {
    expect(form.willCheckLine(checkOf(REPO, WEBSITE), 'ur')).toBe(
      'Ye check honge: repo + website',
    );
  });
});

describe('the words of the one button', () => {
  it('"Check this repo" at first, "Check repo + website" once the website is open', () => {
    expect(form.startButtonLabel(checkOf(), false)).toBe('Check this repo');
    expect(form.startButtonLabel(checkOf(REPO), false)).toBe('Check this repo');
    expect(form.startButtonLabel(checkOf(), true)).toBe('Check repo + website');
    expect(form.startButtonLabel(checkOf(REPO, WEBSITE), true)).toBe(
      'Check repo + website',
    );
  });

  it('names neither once the Supabase part has something in it', () => {
    expect(form.startButtonLabel(checkOf(SUPABASE), false)).toBe(
      'Run these checks',
    );
    expect(
      form.startButtonLabel(checkOf({ projectUrl: SUPABASE.projectUrl }), true),
    ).toBe('Run these checks');
  });

  it('has Roman Urdu', () => {
    expect(form.startButtonLabel(checkOf(), false, 'ur')).toBe(
      'Ye repo check karein',
    );
    expect(form.startButtonLabel(checkOf(), true, 'ur')).toBe(
      'Repo + website check karein',
    );
    expect(form.startButtonLabel(checkOf(SUPABASE), false, 'ur')).toBe(
      'Ye checks chalayein',
    );
  });
});

describe('the hints, in both languages', () => {
  it('say what is missing in Roman Urdu too, and never a value', () => {
    const hint = form.startHintOf(
      checkOf({ projectUrl: 'https://secret-ref.supabase.co' }),
      false,
      'ur',
    );
    expect(hint).toMatch(/^Shuru karne ke liye: access code likhein\./);
    expect(hint).toContain('TEST project wala box');
    expect(hint).not.toContain('secret-ref');
    expect(form.startNote(checkOf(), 'ur')).toContain('live website jodein');
    expect(form.repoUrlProblem('http://x', 'ur')).toContain('sirf https');
  });
});

describe('the page', () => {
  const page = read('app', 'page.tsx');
  const at = (text: string) => page.indexOf(text);

  it('is one form with one button: repo, button, will-check line, the website link, the website', () => {
    expect(page.match(/<form\b/g)).toHaveLength(1);
    expect(page.match(/type="submit"/g)).toHaveLength(1);
    expect(at('<RepoGroup')).toBeGreaterThan(at('id="start-box"'));
    expect(at('type="submit"')).toBeGreaterThan(at('<RepoGroup'));
    expect(at('id="will-check"')).toBeGreaterThan(at('type="submit"'));
    expect(at('website-toggle')).toBeGreaterThan(at('id="will-check"'));
    expect(at('<WebsiteGroup')).toBeGreaterThan(at('website-toggle'));
    expect(at('</form>')).toBeGreaterThan(at('<WebsiteGroup'));
  });

  it('the link opens the website part in place, and it stays open while something is typed', () => {
    expect(page).toContain('aria-expanded={websiteOpen}');
    expect(page).toContain('aria-controls="website-more"');
    expect(page).toContain('id="website-more" hidden={!websiteOpen}');
    expect(page).toContain('onClick={() => setWebsiteAsked((open) => !open)}');
    expect(page).toContain(
      "const websiteOpen = websiteAsked || check.website.state !== 'empty';",
    );
    expect(page).toContain('startButtonLabel(check, websiteOpen, lang)');
    expect(page).toContain('willCheckLine(check, lang)');
  });

  it('has no Label field, no chips, no tabs and no access code of its own', () => {
    expect(page).not.toMatch(/fields\.label|label: event|MoreChecks|CHIPS|role="tab|access-code/);
    expect(read('components', 'connect-groups.tsx')).not.toMatch(
      /fields\.label|MoreChecks|Add more checks/,
    );
  });

  it('keeps the rules and the request of form.ts, and clears the keys after the start', () => {
    expect(page).toContain('checkConnect(fields)');
    expect(page).toContain('buildStartBody(fields)');
    expect(page).toContain('setFields(clearKeys)');
    expect(page).toContain('setError(handleApiError(caught))');
  });

  it('the Supabase part is the last thing on the page, closed at first, with the Groq line in it', () => {
    expect(at('<SupabaseGroup')).toBeGreaterThan(at('</form>'));
    expect(at('<SupabaseGroup')).toBeGreaterThan(at('truth-card'));
    expect(at('ADVANCED.groq')).toBeGreaterThan(at('id="advanced-supabase"'));
    expect(page).toContain('open={advancedOpen}');
    expect(page).toContain(
      "const advancedOpen = advancedAsked || check.supabase.state !== 'empty';",
    );
    // nothing about Groq in the hero
    expect(page.slice(0, at('</form>'))).not.toMatch(/groq/i);
    expect(page.slice(0, at('</form>'))).toContain('FORM.noAi');
  });
});

describe('the access code bar of the header', () => {
  const bar = read('components', 'access-bar.tsx');
  const header = read('components', 'app-header.tsx');
  const provider = read('components', 'app-provider.tsx');

  it('is in the header on the home page, with the id the intro looks for, and submits the start form', () => {
    expect(header).toContain("{pathname === '/' ? <AccessBar /> : null}");
    expect(bar.match(/id="access-code"/g)).toHaveLength(1);
    expect(bar).toContain('form="start-box"');
    expect(bar).toContain('<SecretInput');
    expect(read('components', 'intro-overlay.tsx')).toContain("'access-code'");
  });

  it('keeps the code in memory only: no storage and no cookie anywhere on its way', () => {
    for (const text of [bar, header, provider, read('app', 'page.tsx')]) {
      expect(text).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });

  it('says "Access code (given by the owner)" in both languages', async () => {
    const copy = (await import(
      /* @vite-ignore */ href('lib', 'hero-copy.ts')
    )) as { ACCESS: Record<string, { en: string; ur: string }> };
    expect(copy.ACCESS.label.en).toBe('Access code (given by the owner)');
    for (const pair of Object.values(copy.ACCESS)) {
      expect(pair.ur.length).toBeGreaterThan(3);
    }
  });
});

describe('the three groups, rendered', () => {
  it('the hero field says "Paste your GitHub repo link", with its box', () => {
    const html = render('RepoGroup', 'en');
    expect(html).toContain('Paste your GitHub repo link');
    expect(html).toContain('id="repo-url"');
    expect(html).toContain('This repository is public and I may scan its files.');
    expect(html).not.toContain('id="website-url"');
    expect(html).not.toContain('id="project-url"');
  });

  it('the website and Supabase groups keep their ids and boxes', () => {
    const site = render('WebsiteGroup', 'en');
    expect(site).toContain('id="website-url"');
    expect(site).toContain('I may test this site. It is mine, or I have permission to check it.');
    const db = render('SupabaseGroup', 'en');
    for (const text of ['id="project-url"', 'TEST project', 'Publishable key', 'Secret key']) {
      expect(db).toContain(text);
    }
  });

  it('every group speaks Roman Urdu too', () => {
    expect(render('RepoGroup', 'ur')).toContain('repo ka link paste karein');
    expect(render('WebsiteGroup', 'ur')).toContain('Website ka address');
    expect(render('SupabaseGroup', 'ur')).toContain('production nahi');
  });

  it('the old note and "Add more checks" are gone', () => {
    expect(groups.MoreChecks).toBeUndefined();
    expect(groups.GroupsNote).toBeUndefined();
    expect(existsSync(join(SRC, 'components', 'connect-tabs.tsx'))).toBe(false);
  });
});

describe('the words of the flow', () => {
  it('never claim safety or approval', () => {
    const words = [
      read('app', 'page.tsx'),
      read('components', 'connect-groups.tsx'),
      read('components', 'access-bar.tsx'),
      read('lib', 'hero-copy.ts').replace(/^\/\/.*$/gm, ''),
    ].join('\n');
    expect(words).not.toMatch(
      /\bsafe(ly|ty)?\b|\bsecure[ds]?\b|\bcertifi(ed|cate)\b|\bguarantee|\bmehfooz\b|\bzamanat\b|full audit|autonomous/i,
    );
  });
});
