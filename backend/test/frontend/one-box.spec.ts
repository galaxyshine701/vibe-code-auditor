import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The home page asks for ONE thing first: a public GitHub repository (A1).
// The website and the Supabase project are under "Add more checks (optional)",
// closed at first. Nothing was removed: the same fields, the same rules and the
// same request. These tests read the page and render the groups for real.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const SRC = join(FRONTEND, 'src');
const requireFrontend = createRequire(join(FRONTEND, 'package.json'));
const React = requireFrontend('react') as typeof import('react');
const { renderToStaticMarkup } = requireFrontend(
  'react-dom/server',
) as typeof import('react-dom/server');
const href = (...parts: string[]) => pathToFileURL(join(SRC, ...parts)).href;
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

const form = (await import(/* @vite-ignore */ href('lib', 'form.ts'))) as {
  EMPTY_FIELDS: Record<string, unknown>;
  checkConnect: (f: never) => { canStart: boolean };
  buildStartBody: (f: never) => Record<string, unknown>;
};
const groups = (await import(
  /* @vite-ignore */ href('components', 'connect-groups.tsx')
)) as {
  RepoGroup: (p: never) => unknown;
  MoreChecks: (p: never) => unknown;
  GroupsNote: (p: never) => unknown;
};

function render(
  component: unknown,
  patch: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): string {
  const fields = { ...form.EMPTY_FIELDS, ...patch };
  return renderToStaticMarkup(
    React.createElement(component as never, {
      fields,
      check: form.checkConnect(fields as never),
      onChange: () => undefined,
      ...extra,
    }),
  );
}

describe('the main box of the home page', () => {
  const page = read('app', 'page.tsx');
  const at = (text: string) => page.indexOf(text);

  it('is one form: the repository, "Add more checks", the access code, then Start', () => {
    expect(at('id="start-box"')).toBeGreaterThan(-1);
    expect(at('<RepoGroup')).toBeGreaterThan(at('id="start-box"'));
    expect(at('<MoreChecks')).toBeGreaterThan(at('<RepoGroup'));
    expect(at('<GroupsNote')).toBeGreaterThan(at('<MoreChecks'));
    expect(at('id="access-code"')).toBeGreaterThan(at('<GroupsNote'));
    expect(at("'Start'")).toBeGreaterThan(at('id="access-code"'));
  });

  it('the access code sits in the box, just above Start, and keeps its id (the intro looks for it)', () => {
    expect(page).toContain('id="access-code"');
    expect(page).toContain('className="start-code"');
    // no second access-code field and no old "hero-gate" form field
    expect(page.match(/id="access-code"/g)).toHaveLength(1);
    expect(read('components', 'intro-overlay.tsx')).toContain("'access-code'");
  });

  it('the old separate "Start an audit" card is gone; the form is not in the page twice', () => {
    expect(page).not.toContain('form-card');
    expect(page).not.toContain('Start an audit');
    expect(page.match(/<form\b/g)).toHaveLength(1);
    expect(page.match(/onSubmit=\{submit\}/g)).toHaveLength(1);
  });

  it('keeps the chips as shortcuts that open "Add more checks", and keeps the rules of form.ts', () => {
    expect(page).toContain('setMoreOpen(true)');
    expect(page).toContain('buildStartBody(fields)');
    expect(page).toContain('checkConnect(fields)');
    expect(page).toContain('open={moreOpenNow}');
  });

  it('"Add more checks" stays open while the website or Supabase group has anything in it', () => {
    expect(page).toMatch(
      /moreOpenNow =\s*moreOpen \|\|\s*check\.website\.state !== 'empty' \|\|\s*check\.supabase\.state !== 'empty'/,
    );
  });

  it('says plainly that a run with only a repository reads only that repository', () => {
    expect(page).toContain('Repository checks only');
    expect(page).toContain('The website and Supabase are not checked.');
    expect(page).toMatch(/repoOnly =\s*check\.repo\.state === 'complete' &&\s*check\.website\.state === 'empty' &&\s*check\.supabase\.state === 'empty'/);
  });

  it('never claims a full audit, a guarantee or that it is autonomous', () => {
    const words = [page, read('components', 'connect-groups.tsx')].join('\n');
    expect(words).not.toMatch(/full audit|fully autonomous|autonomous/i);
    expect(words).not.toMatch(/\bsafe(ly|ty)?\b|\bsecure[ds]?\b|\bguarantee/i);
  });
});

describe('the repository group (the main box)', () => {
  it('has the repository address and the box, and none of the other fields', () => {
    const html = render(groups.RepoGroup);
    expect(html).toContain('id="repo-url"');
    expect(html).toContain('This repository is public and I may scan its files.');
    expect(html).toContain('data-group="repo"');
    expect(html).not.toContain('id="website-url"');
    expect(html).not.toContain('id="project-url"');
  });
});

describe('"Add more checks (optional)"', () => {
  it('is closed at first: a details element without the open attribute', () => {
    const html = render(groups.MoreChecks, {}, { open: false, onOpenChange: () => undefined });
    expect(html).toContain('<details');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('Add more checks');
    expect(html).toContain('optional');
  });

  it('is open when told to be', () => {
    const html = render(groups.MoreChecks, {}, { open: true, onOpenChange: () => undefined });
    expect(html).toMatch(/<details[^>]*\sopen/);
  });

  it('still has every field it had: the label, the website group and the Supabase group, with the same ids and boxes', () => {
    const html = render(groups.MoreChecks, {}, { open: false, onOpenChange: () => undefined });
    for (const id of ['website-url', 'project-url']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('data-group="website"');
    expect(html).toContain('data-group="supabase"');
    expect(html).toContain('I may test this site. It is mine, or I have permission to check it.');
    expect(html).toContain('TEST project');
    expect(html).toContain('Publishable key');
    expect(html).toContain('Secret key');
    expect(html).toContain('Used only to name this run. Maximum 120 characters.');
    // the repository is not in there
    expect(html).not.toContain('id="repo-url"');
  });

  it('a half-filled group is named in a note that is outside the closed details', () => {
    const html = render(groups.GroupsNote, { websiteUrl: 'https://example.com' });
    expect(html).toContain('Website still needs:');
    expect(html).toContain('source-note');
    expect(render(groups.GroupsNote, {})).toBe('');
  });
});

describe('the request is the same as before', () => {
  it('a repository alone sends only the repository and its box', () => {
    const body = form.buildStartBody({
      ...form.EMPTY_FIELDS,
      repoUrl: ' https://github.com/example-owner/shop ',
      confirmRepoAccess: true,
    } as never);
    expect(body).toEqual({
      repoUrl: 'https://github.com/example-owner/shop',
      confirmRepoAccess: true,
    });
  });

  it('with the extra checks filled in, the body has all three groups', () => {
    const body = form.buildStartBody({
      ...form.EMPTY_FIELDS,
      repoUrl: 'https://github.com/example-owner/shop',
      confirmRepoAccess: true,
      websiteUrl: 'https://www.example-shop.com',
      confirmSiteAccess: true,
      projectUrl: 'https://abcdefgh.supabase.co',
      anonKey: 'a',
      serviceKey: 'b',
      confirmTestProject: true,
    } as never);
    expect(Object.keys(body).sort()).toEqual(
      [
        'anonKey',
        'confirmRepoAccess',
        'confirmSiteAccess',
        'confirmTestProject',
        'projectUrl',
        'repoUrl',
        'serviceKey',
        'websiteUrl',
      ].sort(),
    );
  });
});
