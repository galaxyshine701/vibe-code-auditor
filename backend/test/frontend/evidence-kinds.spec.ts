import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The repo evidence kinds on the result page: each has its own group with words
// in both languages, in a fixed order, and is shown as path:line.
const SRC = join(__dirname, '..', '..', '..', 'frontend', 'src');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');
const lib = (name: string) => pathToFileURL(join(SRC, 'lib', name)).href;

const stage = (await import(/* @vite-ignore */ lib('stage.ts'))) as {
  groupEvidence: (items: object[]) => { kind: string }[];
};
const copy = (await import(/* @vite-ignore */ lib('stage-copy.ts'))) as {
  t: (lang: 'en' | 'ur', key: string) => string;
};

describe('repo-test-key and repo-env-file on the result page', () => {
  const item = (kind: string) => ({
    id: kind,
    check: 'repo-secrets',
    kind,
    verdict: 'INCONCLUSIVE',
    subject: 'a',
    line: 1,
  });

  it('are groups of their own, between the keys and the variable names', () => {
    const groups = stage.groupEvidence(
      ['repo-migration', 'repo-env-name', 'repo-env-file', 'repo-test-key', 'repo-file'].map(item),
    );
    expect(groups.map((g) => g.kind)).toEqual([
      'repo-file',
      'repo-test-key',
      'repo-env-file',
      'repo-env-name',
      'repo-migration',
    ]);
  });

  it('have a title in both languages', () => {
    expect(copy.t('en', 'kindRepoTestKey')).toBe('Repository test files');
    expect(copy.t('en', 'kindRepoEnvFile')).toBe('Repository env files');
    expect(copy.t('ur', 'kindRepoTestKey')).toBe('Repository ki test files');
    expect(copy.t('ur', 'kindRepoEnvFile')).toBe('Repository ki env files');
  });

  it('are shown as path:line, and keyKind is an optional field of an item', () => {
    const groups = read('components', 'evidence-groups.tsx').replace(/\s+/g, ' ');
    for (const kind of ['repo-test-key', 'repo-env-file']) {
      expect(groups).toContain(`kind === '${kind}'`);
    }
    expect(read('lib', 'stage-types.ts')).toContain('keyKind?: string;');
  });
});
