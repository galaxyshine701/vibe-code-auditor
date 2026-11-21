import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The product name is one constant (frontend/src/lib/brand.ts). The frontend
// has no test runner of its own, so this test runs here and reads the files.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|css|html|js)$/.test(name)) out.push(path);
  }
  return out;
}

describe('the product name', () => {
  const files = [
    ...walk(join(FRONTEND, 'src')),
    ...walk(join(FRONTEND, 'public')),
  ];

  it('is the constant PROJECT_NAME', async () => {
    const brand = (await import(
      /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'brand.ts'))
        .href
    )) as { PROJECT_NAME: string };
    expect(brand.PROJECT_NAME).toBe('Gatecheck');
  });

  it('is spelled in one place only: brand.ts', () => {
    const offenders = files.filter((file) => {
      if (file.endsWith(join('lib', 'brand.ts'))) return false;
      // offline.html is a plain file that cannot import the constant
      if (file.endsWith('offline.html')) return false;
      return /Gatecheck/.test(readFileSync(file, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('leaves no trace of the old name', () => {
    const offenders = files.filter((file) =>
      /Vibe Code Auditor/i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
