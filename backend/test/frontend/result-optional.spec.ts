import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLE_SCAN_LIMITS } from '../../src/stages/planner-config.js';
import { REPO_SCAN_LIMITS } from '../../src/repo/repo-limits.js';

// The result of a run with no Supabase project (the repo-only example): it never
// asks for the project's keys, says once that no table was checked, tells the
// limits of the checks that ran in plain words, and the run page names what was
// not asked for in one line.
const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'frontend', 'src');
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');
const bundle = <T>(name: string) =>
  JSON.parse(
    readFileSync(join(ROOT, 'docs', 'frontend-mock', 'repo-only', name), 'utf8'),
  ) as T;
const load = async <T>(file: string) =>
  (await import(/* @vite-ignore */ pathToFileURL(join(SRC, 'lib', file)).href)) as T;

type Text = { en: string; ur: string };
type Item = { id: string; kind: string; title: Text; why: Text; steps: Text[]; refs: { checkId?: string } };
const stage = await load<{
  withoutSupabaseAsk: (items: Item[]) => Item[];
  gateWithoutSupabaseAsk: (g: { decision: string; reasons: Text[] }) => { reasons: Text[] };
  mergeSameSteps: (items: Item[]) => Item[];
  topActionItems: (report: unknown, items: Item[]) => Item[];
}>('stage.ts');
const limits = await load<{
  PLAIN_LIMITS: Record<string, Text[]>;
  plainLimits: (ids: string[]) => Text[];
}>('plain-limits.ts');

const items = bundle<{ items: Item[] }>('roadmap.json').items;
const report = bundle<unknown>('client-report.json');
const gate = bundle<{ gate: { decision: string; reasons: Text[] } }>('audit.json').gate;

describe('"Do this first" and the next steps of a repo-only run', () => {
  const kept = stage.withoutSupabaseAsk(items);
  const first = stage.topActionItems(report, stage.mergeSameSteps(kept));

  it('never mention a service key or ask for the Supabase project', () => {
    for (const list of [first, kept]) {
      const words = JSON.stringify(list.map((i) => [i.title, i.why, i.steps]));
      expect(words).not.toMatch(/service key|anon key|add supabase|supabase details|project url/i);
    }
    expect(first.length).toBeGreaterThan(0);
    // the bundle itself has such a step, so this test reads something
    expect(JSON.stringify(items)).toContain('service key');
  });

  it('keep the website suggestion', () => {
    expect(kept.some((i) => i.refs.checkId === 'tls-headers')).toBe(true);
    expect(kept).toHaveLength(items.length - 1);
  });

  it('the gate keeps its reasons, without the "not provided" one of the table check', () => {
    const out = stage.gateWithoutSupabaseAsk(gate).reasons.map((r) => r.en);
    expect(out).toHaveLength(gate.reasons.length - 1);
    expect(out.join()).not.toContain('Data access');
    const only = { decision: 'not_ready', reasons: [gate.reasons[1]] };
    expect(stage.gateWithoutSupabaseAsk(only).reasons).toHaveLength(1);
  });

  it('the report page uses both only when there is no Supabase project', () => {
    const page = read('app', 'audits', '[id]', 'report', 'page.tsx');
    expect(page).toContain('noTables && stage?.roadmap');
    expect(page).toContain('noTables ? gateWithoutSupabaseAsk(audit?.gate) : audit?.gate');
  });
});

describe('"no table was checked" is in one place', () => {
  it('the plain optional line; the scope row and the summary do not repeat it', () => {
    const line = read('components', 'stage-invites.tsx');
    expect(line).toContain('className="optional-line"');
    expect(line).toContain('/#advanced-supabase');
    expect(read('components', 'scope-buckets.tsx')).toContain(
      "const optional = check.id === 'data-access-prover' && addable;",
    );
    expect(read('components', 'client-summary.tsx')).toContain(
      'const showTables = hasSupabase || Boolean(report?.findings?.tables);',
    );
    expect(read('app', 'audits', '[id]', 'page.tsx')).not.toContain('No Supabase details');
  });
});

describe('the limits', () => {
  it('are plain, only of the checks that ran, and closed; the full list is "Technical details"', () => {
    const source = read('components', 'scope-buckets.tsx');
    expect(source).toContain('[...buckets.checked, ...buckets.partial]');
    expect(source).not.toMatch(/<details className="limits[^"]*" open/);
    expect(source).toContain("t(lang, 'technicalHeading')");
    const repo = limits.plainLimits(['repo-secrets']).map((l) => l.en).join(' ');
    expect(repo).not.toMatch(/front page|script files|table data/i);
    expect(limits.plainLimits([])).toEqual([]);
    // a sentence two checks share is told once
    const both = limits.plainLimits(['repo-secrets', 'bundle-secrets']);
    expect(new Set(both).size).toBe(both.length);
    for (const pair of Object.values(limits.PLAIN_LIMITS).flat()) {
      expect(pair.ur.length).toBeGreaterThan(20);
    }
  });

  it('carry the numbers of the server', () => {
    expect(REPO_SCAN_LIMITS.maxFileBytes).toBe(1024 * 1024);
    expect(JSON.stringify(limits.PLAIN_LIMITS['repo-secrets'])).toContain('1 MB');
    expect(JSON.stringify(limits.PLAIN_LIMITS['bundle-secrets'])).toContain(
      `${BUNDLE_SCAN_LIMITS.maxFiles} script files`,
    );
  });
});

describe('the run page', () => {
  const page = read('app', 'audits', '[id]', 'page.tsx');

  it('names the modules that were not asked for under "Not checked", not as skipped rows', () => {
    expect(page).toContain("String(module.status) !== 'skipped'");
    expect(page).toContain('activityOrder(asked)');
    expect(page).toContain("t(lang, 'notCheckedLine')");
  });

  it('shows the rows and bars while it runs; afterwards only a failed one', () => {
    expect(page).toMatch(
      /const detailed = isRunning\s*\? asked\s*: asked\.filter\(\(module\) => String\(module\.status\) === 'failed'\);/,
    );
    expect(page).toContain('detailed.map((module, index)');
  });
});
