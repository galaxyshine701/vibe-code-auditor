import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// C4 in the frontend: "N files read" next to "Secrets in repo", only when the
// API sent the number. The number is never counted or guessed here.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const lib = (name: string) =>
  pathToFileURL(join(FRONTEND, 'src', 'lib', name)).href;
const read = (...parts: string[]) =>
  readFileSync(join(FRONTEND, 'src', ...parts), 'utf8');

const stage = (await import(/* @vite-ignore */ lib('stage.ts'))) as {
  repoFilesRead: (c: unknown) => number | null;
};
const copy = (await import(/* @vite-ignore */ lib('stage-copy.ts'))) as {
  filesReadText: (n: number, lang: 'en' | 'ur') => string;
};

describe('repoFilesRead', () => {
  it('gives the number the API sent for the Repo scan', () => {
    expect(
      stage.repoFilesRead({ filesRead: [{ id: 'repo-secrets', count: 42 }] }),
    ).toBe(42);
    expect(
      stage.repoFilesRead({ filesRead: [{ id: 'repo-secrets', count: 0 }] }),
    ).toBe(0);
  });
  it('is null when the field is missing or is about another check', () => {
    expect(stage.repoFilesRead(undefined)).toBeNull();
    expect(stage.repoFilesRead(null)).toBeNull();
    expect(stage.repoFilesRead({})).toBeNull();
    expect(stage.repoFilesRead({ filesRead: [] })).toBeNull();
    expect(
      stage.repoFilesRead({ filesRead: [{ id: 'bundle-secrets', count: 3 }] }),
    ).toBeNull();
  });
  it('is null for a count that is not a whole number of 0 or more', () => {
    for (const count of [-1, 2.5, Number.NaN]) {
      expect(
        stage.repoFilesRead({ filesRead: [{ id: 'repo-secrets', count }] }),
      ).toBeNull();
    }
  });
});

describe('the words', () => {
  it('say N files read in English and Roman Urdu', () => {
    expect(copy.filesReadText(12, 'en')).toBe('12 files read');
    expect(copy.filesReadText(1, 'en')).toBe('1 file read');
    expect(copy.filesReadText(0, 'en')).toBe('0 files read');
    expect(copy.filesReadText(12, 'ur')).toBe('12 files parhi gayin');
  });
});

describe('the wiring', () => {
  const summary = read('components', 'client-summary.tsx');
  const report = read('app', 'audits', '[id]', 'report', 'page.tsx');
  it('the line is shown on the number only (null shows nothing)', () => {
    expect(summary).toContain('repoFilesRead !== null');
    expect(summary).toContain('filesReadText(repoFilesRead, lang)');
    expect(summary).toContain('repoFilesRead = null');
  });
  it('the report page passes the count from the coverage, and nothing else', () => {
    expect(report).toContain('repoFilesRead(stage?.evidence?.coverage)');
  });
});
