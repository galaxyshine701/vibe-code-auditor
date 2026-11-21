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

  it('the page description and the manifest name the three checks and say "by these checks"', async () => {
    const brand = (await import(
      /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'brand.ts'))
        .href
    )) as { PROJECT_DESCRIPTION: string };
    const text = brand.PROJECT_DESCRIPTION;
    expect(text).toContain('live site');
    expect(text).toContain('Supabase');
    expect(text).toContain('two test users');
    expect(text).toContain('public GitHub repo');
    expect(text).toContain('gate result');
    expect(text).toContain('by these checks');
    expect(text).not.toMatch(
      /\b(safe|safely|secure|secured|certified|certificate|guarantee[ds]?)\b/i,
    );
    const layout = readFileSync(join(FRONTEND, 'src', 'app', 'layout.tsx'), 'utf8');
    const manifest = readFileSync(join(FRONTEND, 'src', 'app', 'manifest.ts'), 'utf8');
    expect(layout).toContain('description: PROJECT_DESCRIPTION');
    expect(manifest).toContain('description: PROJECT_DESCRIPTION');
    // the old sentences, which spoke of a website and Supabase only, are gone
    expect(layout + manifest).not.toContain('what another user can reach');
  });

  it('leaves no trace of the old name', () => {
    const offenders = files.filter((file) =>
      /Vibe Code Auditor/i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
