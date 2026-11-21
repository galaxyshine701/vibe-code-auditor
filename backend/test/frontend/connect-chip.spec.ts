import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The state chip of the third (repo) group, rendered for real. The chip must
// follow the fields: nothing typed = "Not used", an address without the box =
// "Needs more", an address and the box = "Ready". It is the same at any width
// (375px included): the text comes from the state, not from the CSS.
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
  checkConnect: (f: never) => never;
};
const groups = (await import(
  /* @vite-ignore */ href('components', 'connect-groups.tsx')
)) as { ConnectGroups: (p: never) => unknown };

function repoChip(patch: Record<string, unknown>): string {
  const fields = { ...form.EMPTY_FIELDS, ...patch };
  const html = renderToStaticMarkup(
    React.createElement(groups.ConnectGroups as never, {
      fields,
      check: form.checkConnect(fields as never),
      onChange: () => undefined,
    }),
  );
  const repo = html.slice(html.indexOf('Public GitHub repo'));
  const match = /source-chip source-(\w+)">([^<]+)</.exec(repo);
  return match ? match[2] : '';
}

describe('the chip of the repo group', () => {
  it('says "Not used" when nothing is typed', () => {
    expect(repoChip({})).toBe('Not used');
  });
  it('says "Needs more" for a valid address without the box', () => {
    expect(repoChip({ repoUrl: 'https://github.com/example-owner/shop' })).toBe(
      'Needs more',
    );
  });
  it('says "Ready" for an address and the box', () => {
    expect(
      repoChip({
        repoUrl: 'https://github.com/example-owner/shop',
        confirmRepoAccess: true,
      }),
    ).toBe('Ready');
  });
});
