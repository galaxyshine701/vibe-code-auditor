import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// The rows of the progress screen (frontend/src/lib/progress-rows.ts, R75),
// run on the real mock bundles. The frontend has no test runner of its own.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'frontend-mock');

type Lang = 'en' | 'ur';
interface Module {
  id: string;
  name: string;
  status: string;
  progress: number;
  reason?: { en: string; ur?: string };
  message?: string;
}
interface View {
  tone: string;
  statusLabel: string;
  showBar: boolean;
  percent: number;
  note: string;
  noteKind: string | null;
}
const rows = (await import(
  /* @vite-ignore */ pathToFileURL(
    join(FRONTEND, 'src', 'lib', 'progress-rows.ts'),
  ).href
)) as {
  rowView: (m: Module, lang: Lang) => View;
  hasReasons: (m: Module[] | undefined) => boolean;
  targetLines: (
    t: Record<string, string> | undefined,
  ) => { kind: string; url: string }[];
};

function bundle(name: string) {
  return JSON.parse(readFileSync(join(DOCS, name, 'audit.json'), 'utf8')) as {
    modules: Module[];
    target: Record<string, string>;
  };
}
const url = bundle('url-only');
const supabase = bundle('supabase-only');

describe('a skipped row is not a failure (R75)', () => {
  const prover = url.modules.find((m) => m.id === 'data-access-prover')!;

  it('is neutral, has no bar and no percent, and shows its reason', () => {
    const view = rows.rowView(prover, 'en');
    expect(view.tone).toBe('skipped');
    expect(view.statusLabel).toBe('Skipped');
    expect(view.showBar).toBe(false);
    expect(view.noteKind).toBe('reason');
    expect(view.note).toMatch(/^Not provided/);
  });

  it('shows the reason in the chosen language, and English when the other is missing', () => {
    expect(rows.rowView(prover, 'ur').note).toMatch(/^Diya nahi gaya/);
    const onlyEn = { ...prover, reason: { en: 'Only English.' } };
    expect(rows.rowView(onlyEn, 'ur').note).toBe('Only English.');
  });

  it('ownership is always skipped, with its reason', () => {
    for (const b of [url, supabase, bundle('both')]) {
      const ownership = b.modules.find((m) => m.id === 'ownership')!;
      const view = rows.rowView(ownership, 'en');
      expect(view.tone).toBe('skipped');
      expect(view.note).toBe('Ownership of the site is not checked yet.');
    }
  });

  it('a skipped row without a reason still does not crash', () => {
    const view = rows.rowView(
      { id: 'x', name: 'X', status: 'skipped', progress: 0 },
      'en',
    );
    expect(view.note).toBe('');
    expect(view.noteKind).toBeNull();
  });
});

describe('the other rows', () => {
  it('a completed row has its bar at the value of the backend', () => {
    const planner = url.modules.find((m) => m.id === 'planner')!;
    const view = rows.rowView(planner, 'en');
    expect(view).toMatchObject({
      tone: 'completed',
      statusLabel: 'Completed',
      showBar: true,
      percent: 100,
      note: '',
    });
  });

  it('a failed row shows its message (a TIMEOUT step: "took too long")', () => {
    const view = rows.rowView(
      {
        id: 'data-access-prover',
        name: 'Data Access Prover',
        status: 'failed',
        progress: 40,
        message: 'This step took too long and was stopped.',
      },
      'en',
    );
    expect(view.tone).toBe('failed');
    expect(view.noteKind).toBe('message');
    expect(view.note).toBe('This step took too long and was stopped.');
    expect(view.showBar).toBe(true);
  });

  it('an unknown status is shown as given, never a crash (R72)', () => {
    const view = rows.rowView(
      { id: 'x', name: 'X', status: 'paused', progress: 10 },
      'en',
    );
    expect(view.tone).toBe('unknown');
    expect(view.statusLabel).toBe('paused');
    expect(
      rows.rowView({ id: 'x', name: 'X', status: '', progress: 10 }, 'en')
        .statusLabel,
    ).toBe('Unknown');
  });

  it('a bad progress value is kept between 0 and 100', () => {
    const at = (progress: unknown) =>
      rows.rowView(
        { id: 'x', name: 'X', status: 'running', progress } as Module,
        'en',
      ).percent;
    expect(at(250)).toBe(100);
    expect(at(-5)).toBe(0);
    expect(at(undefined)).toBe(0);
    expect(at('abc')).toBe(0);
  });
});

describe('the toggle and the target lines', () => {
  it('the language toggle is shown only when a row has a reason', () => {
    expect(rows.hasReasons(url.modules)).toBe(true);
    expect(
      rows.hasReasons([
        { id: 'a', name: 'A', status: 'completed', progress: 100 },
      ]),
    ).toBe(false);
    expect(rows.hasReasons(undefined)).toBe(false);
  });

  it('shows the website, the Supabase project, or both, from the target', () => {
    expect(rows.targetLines(url.target)).toEqual([
      { kind: 'website', url: 'https://www.example-shop.com' },
    ]);
    expect(rows.targetLines(supabase.target)).toEqual([
      { kind: 'supabase', url: 'https://example-project.supabase.co' },
    ]);
    expect(rows.targetLines(bundle('both').target).map((l) => l.kind)).toEqual([
      'website',
      'supabase',
    ]);
    expect(rows.targetLines(undefined)).toEqual([]);
  });
});

describe('the progress page follows the rows it receives', () => {
  const page = readFileSync(
    join(FRONTEND, 'src', 'app', 'audits', '[id]', 'page.tsx'),
    'utf8',
  );

  it('maps audit.modules in the order received and hard-codes no row', () => {
    expect(page).toContain('audit.modules.map(');
    for (const id of [
      'data-access-prover',
      'planner',
      'ownership',
      'tls-headers',
      'bundle-secrets',
      'evidence',
      'roadmap',
      'guide',
    ]) {
      expect(page).not.toContain(`'${id}'`);
    }
  });

  it('does not count progress itself', () => {
    expect(page).not.toMatch(/Date\.now|elapsed|setInterval/);
  });

  it('adds the secret keys of the site to the badge input, not leaked alone (R73)', () => {
    expect(page).toContain('leaked: leakCount(result.summary)');
    expect(page).not.toContain('leaked: result.summary.leaked');
  });
});

describe('with the stage bundles, the rows follow the files', () => {
  it('url-only: 3 rows skipped or not, 8 rows in all, in the order of the file', () => {
    vi.resetModules();
    const order = url.modules.map((m) => m.id);
    expect(order).toEqual([
      'data-access-prover',
      'planner',
      'ownership',
      'tls-headers',
      'bundle-secrets',
      'evidence',
      'roadmap',
      'guide',
    ]);
    const tones = url.modules.map((m) => rows.rowView(m, 'en').tone);
    expect(tones.filter((t) => t === 'skipped')).toHaveLength(2);
    expect(tones.filter((t) => t === 'completed')).toHaveLength(6);
  });
});
