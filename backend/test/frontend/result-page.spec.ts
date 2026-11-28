import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// VCA-H8, the result page: the same step is shown once, the sentence "Findings
// are read only after the audit is completed" is only for a run that is still
// running, and the screen never invents a number the API does not send. The
// frontend has no test runner of its own, so its files are read by path.
const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'frontend', 'src');
const DOCS = join(ROOT, 'docs', 'frontend-mock');
const read = (...parts: string[]) =>
  readFileSync(join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n');
const json = (bundle: string, file: string) =>
  JSON.parse(readFileSync(join(DOCS, bundle, `${file}.json`), 'utf8'));

type Text = { en: string; ur?: string };
interface Item {
  id: string;
  kind: string;
  severity: string;
  fromRequiredCheck?: boolean;
  title?: Text;
  why?: Text;
  steps?: Text[];
  refs?: { checkId?: string; findingIds?: string[]; evidenceIds?: string[] };
  mergedIds?: string[];
}
const stage = (await import(
  /* @vite-ignore */ pathToFileURL(join(SRC, 'lib', 'stage.ts')).href
)) as {
  mergeSameSteps: (items: Item[] | null | undefined) => Item[];
  topActionItems: (
    report: { topActions?: string[] } | null | undefined,
    items: Item[] | null | undefined,
  ) => Item[];
  roadmapItems: (items: Item[] | null | undefined) => Item[];
};

describe('the same step is shown once', () => {
  // the repo-only example: two items for the two checks of a website that was
  // not given, with the same title and the same steps (only the reason differs)
  const roadmap = json('repo-only', 'roadmap').items as Item[];
  const report = json('repo-only', 'client-report') as { topActions: string[] };

  // where the two provide-input items for a website are, and the list around them
  const at = roadmap.findIndex(
    (i) => i.title?.en === 'Add a website address to check the site too',
  );
  const [first, second] = [roadmap[at], roadmap[at + 1]];
  const ids = roadmap.map((i) => i.id);

  it('the example really has the problem: two items with one title and one list of steps', () => {
    expect(at).toBeGreaterThan(-1);
    expect(second.title).toEqual(first.title);
    expect(second.steps).toEqual(first.steps);
    expect(second.why).not.toEqual(first.why);
    // "Do this first" is the first three items of the API
    expect(report.topActions).toEqual(ids.slice(0, 3));
  });

  it('folds them into one step, in the place of the first, and keeps the order', () => {
    const merged = stage.mergeSameSteps(roadmap);
    expect(merged.map((i) => i.id)).toEqual(ids.filter((id) => id !== second.id));
    expect(merged[at].mergedIds).toEqual([second.id]);
    // nothing else is changed: the title, the steps, the kind
    expect(merged[at].title).toEqual(first.title);
    expect(merged[at].steps).toEqual(first.steps);
    expect(merged[at].kind).toBe('provide-input');
  });

  it('keeps both reasons, one after the other, in both languages', () => {
    const merged = stage.mergeSameSteps(roadmap)[at];
    expect(merged.why?.en).toBe(`${first.why!.en} ${second.why!.en}`);
    expect(merged.why?.ur).toBe(`${first.why!.ur} ${second.why!.ur}`);
    expect(merged.why?.en).toContain('Certificate and security headers of the site');
    expect(merged.why?.en).toContain('Secret keys inside the scripts of the site');
  });

  it('does not touch the list it was given, and leaves a different step alone', () => {
    const before = JSON.stringify(roadmap);
    stage.mergeSameSteps(roadmap);
    expect(JSON.stringify(roadmap)).toBe(before);
    // the same title with other steps, or another kind, is another step
    const other = stage.mergeSameSteps([
      first,
      { ...second, steps: [{ en: 'Something else.' }] },
      { ...second, id: 'rm_x', kind: 'confirm' },
    ]);
    expect(other.map((i) => i.id)).toEqual([first.id, second.id, 'rm_x']);
    expect(other.every((i) => i.mergedIds === undefined)).toBe(true);
  });

  it('every other example is left as it was (none of them has the same step twice)', () => {
    for (const bundle of ['supabase-only', 'url-only', 'both']) {
      const items = json(bundle, 'roadmap').items as Item[];
      const merged = stage.mergeSameSteps(items);
      if (bundle === 'supabase-only') {
        // the same problem as the repo example: two website items
        expect(merged.map((i) => i.id)).toEqual(['rm_001', 'rm_002', 'rm_003', 'rm_004']);
      } else {
        expect(merged).toEqual(items);
      }
    }
  });

  it('nothing is lost: an empty, a missing or a titleless list is handled', () => {
    expect(stage.mergeSameSteps(undefined)).toEqual([]);
    expect(stage.mergeSameSteps(null)).toEqual([]);
    expect(stage.mergeSameSteps([])).toEqual([]);
    const titleless = [{ id: 'a', kind: 'k', severity: 'info' }, { id: 'b', kind: 'k', severity: 'info' }];
    expect(stage.mergeSameSteps(titleless).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('"Do this first" lists the step once, and a link to a folded-in id still finds it', () => {
    const merged = stage.mergeSameSteps(roadmap);
    const both = { topActions: [first.id, second.id] };
    expect(stage.topActionItems(both, merged).map((i) => i.id)).toEqual([first.id]);
    // the old behaviour (the raw list) is unchanged
    expect(stage.topActionItems(both, roadmap).map((i) => i.id)).toEqual(both.topActions);
    // a report that names only the folded-in id finds the step
    expect(
      stage.topActionItems({ topActions: [second.id] }, merged).map((i) => i.id),
    ).toEqual([first.id]);
  });

  it('the summary and the roadmap both use it, so the two lists agree', () => {
    expect(read('components', 'client-summary.tsx')).toContain(
      'topActionItems(report, mergeSameSteps(roadmapItems))',
    );
    expect(read('components', 'roadmap-list.tsx')).toContain(
      'mergeSameSteps(roadmapItems(roadmap?.items))',
    );
  });
});

describe('"Findings are read only after the audit is completed"', () => {
  const SENTENCE = 'Findings are read only after the audit';
  const run = read('app', 'audits', '[id]', 'page.tsx');
  const report = read('app', 'audits', '[id]', 'report', 'page.tsx');

  it('is on the run page once, and only in the part that is shown while the run is running', () => {
    expect(run.match(/Findings are read only after the audit/g)).toHaveLength(1);
    const at = run.indexOf(SENTENCE);
    // the paragraph that holds it sits after the check `isRunning ?`
    const guard = run.lastIndexOf('{isRunning ? (', at);
    expect(guard).toBeGreaterThan(-1);
    expect(at - guard).toBeLessThan(200);
  });

  it('is not next to the "View report" button of a completed run', () => {
    const completed = run.slice(
      run.search(/\{status === 'completed' \? \(\s*<div className="action-row">/),
    );
    expect(completed.slice(0, 500)).toContain('View report');
    expect(completed.slice(0, 500)).not.toContain('Findings are read only');
  });

  it('is not on the report page (it is only reached after the run)', () => {
    expect(report).not.toContain('Findings are read only');
    expect(report).toContain('Reading the report…');
  });
});

describe('the repo summary shows only what the API sends', () => {
  it('shows the count of files read only from the coverage the API sent (never counted here)', () => {
    const summary = read('components', 'client-summary.tsx');
    // the line is drawn only for a number, and the number comes in from outside
    expect(summary).toContain('repoFilesRead !== null');
    expect(summary).toContain('repoFilesRead = null');
    expect(summary).not.toMatch(/filesScanned/);
    expect(read('app', 'audits', '[id]', 'report', 'page.tsx')).toContain(
      'repoFilesRead(stage?.evidence?.coverage)',
    );
    // the list of what was not read is the API's, and the scope screen shows it
    expect(read('components', 'scope-buckets.tsx')).toContain("t(lang, 'notRead')");
  });
});
