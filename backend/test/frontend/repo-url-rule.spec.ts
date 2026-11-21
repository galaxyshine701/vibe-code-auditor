import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAuditRequest } from '../../src/audits/audit-input.js';

// ONE rule for the repository address: the frontend's isValidRepoUrl must give
// the same answer as the backend's parser for every address below. If one side
// changes, this test fails until the other follows.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const requireFrontend = createRequire(join(FRONTEND, 'package.json'));
const React = requireFrontend('react') as typeof import('react');
const { renderToStaticMarkup } = requireFrontend(
  'react-dom/server',
) as typeof import('react-dom/server');
const href = (...parts: string[]) =>
  pathToFileURL(join(FRONTEND, 'src', ...parts)).href;
const form = (await import(/* @vite-ignore */ href('lib', 'form.ts'))) as {
  EMPTY_FIELDS: Record<string, unknown>;
  checkConnect: (f: never) => {
    repo: { state: string; missing: string[] };
    canStart: boolean;
  };
  isValidRepoUrl: (v: string) => boolean;
  repoUrlProblem: (v: string) => string;
};
const groups = (await import(
  /* @vite-ignore */ href('components', 'connect-groups.tsx')
)) as { ConnectGroups: (p: never) => unknown };

const backendAccepts = (repoUrl: string): boolean => {
  try {
    parseAuditRequest({ repoUrl, confirmRepoAccess: true }, true);
    return true;
  } catch {
    return false;
  }
};

const VALID = [
  'https://github.com/owner/repo',
  'https://github.com/owner/repo/',
  'https://github.com/owner/repo.git',
  'https://github.com/owner/repo.git/',
  '  https://github.com/owner/repo  ',
  'https://GITHUB.com/owner/repo', // the URL parser lower-cases the host, in both
  'https://github.com/a/b',
];
const INVALID = [
  'http://github.com/a/b',
  'https://github.com/owner',
  'https://github.com/',
  'https://github.com',
  'https://github.com/a/b/c',
  'https://github.com/a/b/tree/main',
  'https://github.com/a/b?x=1',
  'https://github.com/a/b#readme',
  'https://www.github.com/a/b',
  'https://gitlab.com/a/b',
  'https://github.com:8080/a/b',
  'https://user@github.com/a/b',
  'https://github.com/a/b//',
  'https://github.com/a b/c',
  'github.com/a/b',
  'owner/repo',
  'https://github.com/../b',
  'https://github.com/a/..',
  'ftp://github.com/a/b',
  '',
];

describe('the repository address rule is the same in the frontend and the backend', () => {
  for (const value of VALID) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(form.isValidRepoUrl(value)).toBe(true);
      expect(backendAccepts(value)).toBe(true);
    });
  }
  for (const value of INVALID) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      expect(form.isValidRepoUrl(value)).toBe(false);
      expect(backendAccepts(value)).toBe(false);
    });
  }
  it('refuses an address longer than 300 characters, like the backend', () => {
    const long = `https://github.com/owner/${'a'.repeat(300)}`;
    expect(form.isValidRepoUrl(long)).toBe(false);
    expect(backendAccepts(long)).toBe(false);
  });
});

function render(patch: Record<string, unknown>) {
  const fields = { ...form.EMPTY_FIELDS, ...patch };
  const html = renderToStaticMarkup(
    React.createElement(groups.ConnectGroups as never, {
      fields,
      check: form.checkConnect(fields as never),
      onChange: () => undefined,
    }),
  );
  const repo = html.slice(html.indexOf('Public GitHub repo'));
  const chip = /source-chip source-(\w+)">([^<]+)</.exec(repo);
  return { chip: chip ? chip[2] : '', html: repo };
}

describe('a wrong address keeps the chip at "Needs more" with a clear message', () => {
  for (const value of ['http://github.com/a/b', 'https://github.com/a/b/c']) {
    for (const box of [true, false]) {
      it(`${value}, box ${box ? 'ticked' : 'not ticked'}`, () => {
        const fields = { repoUrl: value, confirmRepoAccess: box };
        expect(render(fields).chip).toBe('Needs more');
        expect(render(fields).html).toContain('id="repo-url-problem"');
        expect(render(fields).html).toContain('Use exactly https://github.com/owner/repo');
        const check = form.checkConnect({ ...form.EMPTY_FIELDS, ...fields } as never);
        expect(check.repo.state).toBe('partial');
        expect(check.canStart).toBe(false);
      });
    }
  }
  it('shows no message and "Ready" for a valid address with the box', () => {
    const out = render({
      repoUrl: 'https://github.com/a/b',
      confirmRepoAccess: true,
    });
    expect(out.chip).toBe('Ready');
    expect(out.html).not.toContain('repo-url-problem');
  });
  it('shows no message while the field is empty or only spaces', () => {
    expect(form.repoUrlProblem('')).toBe('');
    expect(form.repoUrlProblem('   ')).toBe('');
    expect(render({}).chip).toBe('Not used');
  });
  it('a wrong address does not block a complete website group from being flagged: the form stays blocked until it is fixed or cleared', () => {
    const check = form.checkConnect({
      ...form.EMPTY_FIELDS,
      websiteUrl: 'https://example.com',
      confirmSiteAccess: true,
      repoUrl: 'http://github.com/a/b',
    } as never);
    expect(check.canStart).toBe(false);
  });
});
