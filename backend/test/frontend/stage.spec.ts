import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The logic of the Report of the agent pipeline (frontend/src/lib/stage.ts and
// check-labels.ts), run on the three real mock bundles of docs/frontend-mock.
// The frontend has no test runner of its own, so the files are loaded by path.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'frontend-mock');

type Text = { en: string; ur?: string };
interface Audit {
  target: { projectUrl?: string; websiteUrl?: string };
  summary: Record<string, number>;
  schemaVersion?: number;
  gate?: { decision: string };
  plan?: { id: string; required?: boolean }[];
}
interface Item {
  id: string;
  kind?: string;
  findingId?: string | null;
  fromRequiredCheck?: boolean;
  [key: string]: unknown;
}
interface Bundle {
  audit: Audit;
  evidence: { items: Item[]; coverage: Record<string, unknown> };
  roadmap: { items: (Item & { kind: string })[] };
  clientReport: {
    headline: Text;
    topActions: string[];
    scope: Record<string, { id?: string; name?: string }[]>;
    limits: Text[];
  };
}

const stage = (await import(
  /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'stage.ts'))
    .href
)) as Record<string, (...args: never[]) => unknown> & {
  headlineOf: (
    audit: unknown,
    report: unknown,
  ) => { text: Text; tone: string } | null;
};
const labels = (await import(
  /* @vite-ignore */ pathToFileURL(
    join(FRONTEND, 'src', 'lib', 'check-labels.ts'),
  ).href
)) as {
  checkLabel: (id: string, lang: 'en' | 'ur') => string;
  subjectLabel: (id: string, lang: 'en' | 'ur') => string;
};

function read(name: string): Bundle {
  const file = (f: string) =>
    JSON.parse(readFileSync(join(DOCS, name, `${f}.json`), 'utf8'));
  return {
    audit: file('audit'),
    evidence: file('evidence'),
    roadmap: file('roadmap'),
    clientReport: file('client-report'),
  };
}
const supabase = read('supabase-only');
const url = read('url-only');
const both = read('both');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (name: string, ...args: unknown[]): any =>
  (stage[name] as unknown as (...a: unknown[]) => unknown)(...args);

describe('pick: a text in the chosen language (R82)', () => {
  it('gives the language asked for, and English when the other is missing', () => {
    expect(call('pick', { en: 'a', ur: 'b' }, 'ur')).toBe('b');
    expect(call('pick', { en: 'a', ur: 'b' }, 'en')).toBe('a');
    expect(call('pick', { en: 'a' }, 'ur')).toBe('a');
    expect(call('pick', { en: 'a', ur: '' }, 'ur')).toBe('a');
    expect(call('pick', undefined, 'ur')).toBe('');
  });
});

describe('headlineOf: never summary.leaked alone (R73)', () => {
  it('uses the headline of the client report', () => {
    const h = call('headlineOf', url.audit, url.clientReport);
    expect(h.text).toEqual(url.clientReport.headline);
    // a website with a secret key and zero leaking tables is a leak
    expect(url.audit.summary.leaked).toBe(0);
    expect(h.tone).toBe('leak');
  });

  it('without a client report, a secret key in a script is still a leak, never "no leak"', () => {
    const h = call('headlineOf', url.audit, null);
    expect(h.tone).toBe('leak');
    expect(h.text.en).not.toMatch(/^No leak/);
  });

  it('no leak is "No leak found by these checks." only when the gate says so', () => {
    const clean = { summary: { leaked: 0, blocked: 2, inconclusive: 0 } };
    const ready = call(
      'headlineOf',
      {
        ...clean,
        gate: { decision: 'ready_by_these_checks' },
      },
      null,
    );
    expect(ready.text.en).toBe('No leak found by these checks.');
    expect(ready.tone).toBe('clear');
    const notReady = call(
      'headlineOf',
      {
        ...clean,
        gate: { decision: 'not_ready' },
      },
      null,
    );
    expect(notReady.text.en).not.toMatch(/No leak/);
    expect(notReady.tone).toBe('not-ready');
  });

  it('siteLeaked missing is 0, and an old answer has no headline of its own (R72)', () => {
    expect(call('leakCount', { leaked: 1, blocked: 0, inconclusive: 0 })).toBe(
      1,
    );
    expect(call('leakCount', { leaked: 1, siteLeaked: 2 })).toBe(3);
    expect(call('leakCount', undefined)).toBe(0);
    expect(
      call(
        'headlineOf',
        { summary: { leaked: 0, blocked: 1, inconclusive: 0 } },
        null,
      ),
    ).toBeNull();
  });

  it('every bundle with a leak has a leak tone', () => {
    for (const b of [supabase, url, both]) {
      expect(call('headlineOf', b.audit, b.clientReport).tone).toBe('leak');
    }
  });
});

describe('bucketsOf: each bucket on its own (R78)', () => {
  const buckets = (b: Bundle) =>
    call('bucketsOf', b.clientReport, b.evidence.coverage, b.audit.plan);
  const ids = (list: { id: string }[]) => list.map((c) => c.id);

  it('Supabase only: the website checks are Not provided, active checks Not implemented', () => {
    const r = buckets(supabase);
    expect(ids(r.checked)).toEqual(['data-access-prover']);
    expect(ids(r.notProvided)).toEqual(['tls-headers', 'bundle-secrets']);
    expect(ids(r.notImplemented)).toEqual(['active-checks']);
    expect(r.source).toBe('client-report');
    // the optional website checks are not required in this run
    expect(
      r.notProvided.every((c: { required?: boolean }) => c.required === false),
    ).toBe(true);
  });

  it('website only: the table check is Not provided and the out-of-scope list is kept', () => {
    const r = buckets(url);
    expect(ids(r.notProvided)).toEqual(['data-access-prover']);
    expect(ids(r.checked)).toEqual(['tls-headers', 'bundle-secrets']);
    expect(r.outOfScope.map((o: { name: string }) => o.name)).toEqual([
      'TLS validity period and expiry',
    ]);
    expect(r.limits.length).toBeGreaterThan(0);
  });

  it('both: nothing is not provided', () => {
    const r = buckets(both);
    expect(r.notProvided).toEqual([]);
    expect(ids(r.checked)).toEqual([
      'data-access-prover',
      'tls-headers',
      'bundle-secrets',
    ]);
  });

  it('a reason from the coverage is attached to its check', () => {
    const r = buckets(url);
    expect(r.notProvided[0].reason.en).toMatch(/^Not provided/);
    expect(r.notImplemented[0].reason.en).toMatch(/^Not implemented yet/);
  });

  it('fallback without a client report: the start of the reason decides (R78)', () => {
    const r = call('bucketsOf', null, url.evidence.coverage, url.audit.plan);
    expect(r.source).toBe('coverage');
    expect(ids(r.notProvided)).toEqual(['data-access-prover']);
    expect(ids(r.notImplemented)).toEqual(['active-checks']);
  });

  it('partial lists every name that was not read; failed to run is its own bucket', () => {
    const coverage = {
      checked: ['tls-headers'],
      partial: [
        {
          id: 'bundle-secrets',
          reason: { en: 'Some scripts were not read.' },
          notRead: [
            { name: 'a.example.com/x.js', reason: { en: 'too big' } },
            { name: 'a.example.com/y.js', reason: { en: 'timeout' } },
          ],
        },
      ],
      failedToRun: [
        { id: 'data-access-prover', reason: { en: 'It stopped.' } },
      ],
      skipped: [],
      outOfScope: [],
      limits: [],
    };
    const r = call('bucketsOf', null, coverage, []);
    expect(r.partial).toHaveLength(1);
    expect(r.partial[0].notRead.map((n: { name: string }) => n.name)).toEqual([
      'a.example.com/x.js',
      'a.example.com/y.js',
    ]);
    expect(ids(r.failedToRun)).toEqual(['data-access-prover']);
  });

  it('with neither a client report nor a coverage there are no buckets', () => {
    expect(call('bucketsOf', null, null)).toBeNull();
    expect(call('bucketsOf', undefined, undefined)).toBeNull();
  });
});

describe('groupEvidence: by kind, a missing kind is a table (R79)', () => {
  it('both: tables, then site headers, then scripts, each in the order received', () => {
    const groups = call('groupEvidence', both.evidence.items);
    expect(groups.map((g: { kind: string }) => g.kind)).toEqual([
      'table',
      'site-headers',
      'site-bundle',
    ]);
    expect(groups.map((g: { items: unknown[] }) => g.items.length)).toEqual([
      3, 6, 1,
    ]);
  });

  it('website only has no tables group; Supabase only has no site groups', () => {
    expect(
      call('groupEvidence', url.evidence.items).map(
        (g: { kind: string }) => g.kind,
      ),
    ).toEqual(['site-headers', 'site-bundle']);
    expect(
      call('groupEvidence', supabase.evidence.items).map(
        (g: { kind: string }) => g.kind,
      ),
    ).toEqual(['table']);
  });

  it('site items have a null findingId and table, and are accepted', () => {
    const site = call('groupEvidence', url.evidence.items)[0].items[0];
    expect(site.findingId).toBeNull();
    expect(site.table).toBeNull();
  });

  it('an unknown kind goes last, as its own group; nothing is thrown away', () => {
    const items = [
      { id: 'a', kind: 'something-new' },
      { id: 'b' },
      { id: 'c', kind: 'site-bundle' },
    ];
    const groups = call('groupEvidence', items);
    expect(groups.map((g: { kind: string }) => g.kind)).toEqual([
      'table',
      'site-bundle',
      'something-new',
    ]);
    expect(call('groupEvidence', undefined)).toEqual([]);
  });
});

describe('what the screen offers (R74, R83)', () => {
  it('no Re-test without Supabase details', () => {
    expect(call('canRetest', url.audit)).toBe(false);
    expect(call('canRetest', supabase.audit)).toBe(true);
    expect(call('canRetest', both.audit)).toBe(true);
  });

  it('Supabase only invites to add a website; both and website only do not', () => {
    expect(call('invitesWebsite', supabase.audit)).toBe(true);
    expect(call('invitesWebsite', both.audit)).toBe(false);
    expect(call('invitesWebsite', url.audit)).toBe(false);
    // an old answer (flag off) never shows it
    expect(
      call('invitesWebsite', { target: { projectUrl: 'https://x' } }),
    ).toBe(false);
  });

  it('website only is told from the others by the target', () => {
    expect(call('websiteOnly', url.audit)).toBe(true);
    expect(call('websiteOnly', both.audit)).toBe(false);
    expect(call('websiteOnly', supabase.audit)).toBe(false);
  });

  it('stages exist from schemaVersion 2; a missing version is 1', () => {
    expect(call('hasStages', { schemaVersion: 2 })).toBe(true);
    expect(call('hasStages', { schemaVersion: 3 })).toBe(true);
    expect(call('hasStages', {})).toBe(false);
    expect(call('hasStages', { schemaVersion: 1 })).toBe(false);
  });
});

describe('the roadmap (R81)', () => {
  it('is kept in the order received', () => {
    const ids = call('roadmapItems', both.roadmap.items).map((i: Item) => i.id);
    expect(ids).toEqual(both.roadmap.items.map((i) => i.id));
    expect(call('roadmapItems', undefined)).toEqual([]);
  });

  it('"Required check" is only on fix-* and improve-header items', () => {
    for (const b of [supabase, url, both]) {
      for (const item of b.roadmap.items) {
        const wanted =
          item.fromRequiredCheck === true &&
          (item.kind.startsWith('fix-') || item.kind === 'improve-header');
        expect(call('showsRequiredLabel', item)).toBe(wanted);
      }
    }
    // the kinds that never carry it, even when the flag is true
    for (const kind of [
      'confirm',
      'cleanup',
      'finish-check',
      'provide-input',
      'retest',
    ]) {
      expect(
        call('showsRequiredLabel', { kind, fromRequiredCheck: true }),
      ).toBe(false);
    }
  });

  it('"Do this first" are the first items named by the client report, in its order', () => {
    const top = call('topActionItems', both.clientReport, both.roadmap.items);
    expect(top.map((i: Item) => i.id)).toEqual(both.clientReport.topActions);
    expect(call('topActionItems', null, both.roadmap.items)).toEqual([]);
    expect(call('topActionItems', both.clientReport, undefined)).toEqual([]);
  });

  it('"Roadmap not available." in the limits means no steps are shown', () => {
    expect(
      call('roadmapUnavailable', {
        limits: [{ en: 'Roadmap not available.' }],
      }),
    ).toBe(true);
    expect(call('roadmapUnavailable', both.clientReport)).toBe(false);
    expect(call('roadmapUnavailable', null)).toBe(false);
  });
});

describe('the labels of checks are written by the UI (R87)', () => {
  it('has the four fixed labels in both languages', () => {
    expect(labels.checkLabel('tls-headers', 'en')).toBe(
      'Website headers and HTTPS',
    );
    expect(labels.checkLabel('bundle-secrets', 'en')).toBe(
      "Secret keys in the site's scripts",
    );
    expect(labels.checkLabel('data-access-prover', 'en')).toBe(
      'Table data access',
    );
    expect(labels.checkLabel('active-checks', 'en')).toBe(
      'Active checks (not built yet)',
    );
    for (const id of [
      'tls-headers',
      'bundle-secrets',
      'data-access-prover',
      'active-checks',
    ]) {
      expect(labels.checkLabel(id, 'ur')).not.toBe(labels.checkLabel(id, 'en'));
    }
  });

  it('shows an unknown id as the id', () => {
    expect(labels.checkLabel('new-check', 'en')).toBe('new-check');
    expect(labels.checkLabel('new-check', 'ur')).toBe('new-check');
  });

  it('never shows the title of the API: the label does not come from plan[].title', () => {
    const apiTitle = supabase.audit.plan?.find((c) => c.id === 'tls-headers');
    expect(JSON.stringify(apiTitle)).toMatch(/Certificate/);
    for (const lang of ['en', 'ur'] as const) {
      expect(labels.checkLabel('tls-headers', lang)).not.toMatch(
        /certificate/i,
      );
    }
  });

  it('shows a subject it does not know as given (a script, a new header)', () => {
    expect(labels.subjectLabel('https', 'en')).toBe('HTTPS');
    expect(
      labels.subjectLabel('www.example-shop.com/assets/app.js', 'en'),
    ).toBe('www.example-shop.com/assets/app.js');
    expect(labels.subjectLabel('permissions-policy', 'ur')).toBe(
      'permissions-policy',
    );
  });
});
