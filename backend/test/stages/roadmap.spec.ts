import { describe, expect, it } from 'vitest';
import {
  KIND_RANK,
  ROADMAP_CAP,
  buildRoadmap,
  type RoadmapInput,
} from '../../src/stages/roadmap.js';
import type { RoadmapItem } from '../../src/stages/types.js';
import {
  ALL_FIXTURES,
  BANNED_EN,
  BANNED_UR,
  allStrings,
  both,
  bundleItem,
  finding,
  headerItems,
  makeFixture,
  shuffled,
  supabaseOnly,
  urlOnly,
  type StageFixture,
} from './roadmap-fixtures.js';

const inputOf = (f: StageFixture): RoadmapInput => ({
  plan: f.plan,
  findings: f.findings,
  evidence: f.evidence,
  coverage: f.coverage,
  cleanup: f.cleanup,
  provided: f.provided,
});

const kindsOf = (items: RoadmapItem[]) => items.map((i) => i.kind);
const SEVERITY_RANK = ['critical', 'high', 'medium', 'low', 'info'];

describe('roadmap: the three fixtures', () => {
  it('Supabase only: fix the leak, confirm the unclear table, provide the website, re-test', () => {
    const roadmap = buildRoadmap(inputOf(supabaseOnly()));
    expect(roadmap.schemaVersion).toBe(1);
    expect(roadmap.truncated).toBe(0);
    expect(kindsOf(roadmap.items)).toEqual([
      'fix-finding',
      'confirm',
      'retest', // info, from a required check: before the optional ones
      'provide-input',
      'provide-input',
    ]);
    const fix = roadmap.items[0];
    expect(fix.severity).toBe('critical');
    expect(fix.fromRequiredCheck).toBe(true);
    expect(fix.refs).toEqual({
      checkId: 'data-access-prover',
      findingIds: ['fnd_001'],
      evidenceIds: ['ev_fnd_001'],
    });
    expect(fix.title.en).toContain('bookings');
    // the SQL is not copied: the item points at the finding that holds it
    expect(JSON.stringify(fix)).not.toMatch(/create policy|enable row level/i);
  });

  it('URL only: the secret key first, then the weak headers; no re-test (there is no Supabase)', () => {
    const roadmap = buildRoadmap(inputOf(urlOnly()));
    expect(kindsOf(roadmap.items)).toEqual([
      'fix-site-secret', // critical
      'improve-header', // strict-transport-security: medium
      'improve-header', // content-security-policy: medium
      'improve-header', // x-content-type-options: low
      'improve-header', // referrer-policy: info
      'provide-input', // Supabase details not provided: info
    ]);
    const severities = roadmap.items.map((i) => i.severity);
    expect(severities).toEqual(['critical', 'medium', 'medium', 'low', 'info', 'info']);
    expect(roadmap.items.some((i) => i.kind === 'retest')).toBe(false);
    const secret = roadmap.items[0];
    expect(secret.refs.checkId).toBe('bundle-secrets');
    expect(secret.title.en).toContain('www.example-shop.com/assets/app.js');
  });

  it('both: leak, secret, failed cleanup, partly read scripts, and a re-test', () => {
    const roadmap = buildRoadmap(inputOf(both()));
    const kinds = kindsOf(roadmap.items);
    expect(kinds).toContain('fix-finding');
    expect(kinds).toContain('fix-site-secret');
    expect(kinds).toContain('cleanup');
    expect(kinds).toContain('finish-check');
    expect(kinds).toContain('improve-header');
    expect(kinds).toContain('retest');
    // not provided: nothing (both were given)
    expect(kinds).not.toContain('provide-input');
    const cleanup = roadmap.items.find((i) => i.kind === 'cleanup')!;
    expect(cleanup.severity).toBe('high');
    const https = roadmap.items.find(
      (i) => i.kind === 'improve-header' && i.refs.evidenceIds?.[0] === 'ev_site_tls-headers_1',
    )!;
    expect(https.severity).toBe('high'); // https is high
  });
});

describe('roadmap: what gets an item and what does not', () => {
  it('a BLOCKED table never gets an item', () => {
    const f = supabaseOnly();
    const roadmap = buildRoadmap(inputOf(f));
    const refs = JSON.stringify(roadmap.items.map((i) => i.refs));
    expect(refs).not.toContain('fnd_002');
    expect(refs).not.toContain('ev_fnd_002');
  });

  it('a check that is "not implemented" (active checks) and ownership never get an item', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const f = make();
      expect(f.coverage.skipped.some((s) => s.id === 'active-checks')).toBe(true);
      const roadmap = buildRoadmap(inputOf(f));
      expect(roadmap.items.some((i) => i.refs.checkId === 'active-checks')).toBe(false);
      expect(JSON.stringify(roadmap)).not.toMatch(/ownership/i);
    }
  });

  it('a header that is present (BLOCKED) never gets an item; a missing one does, with the right severity', () => {
    const f = makeFixture({
      provided: { supabase: false, website: true },
      siteEvidence: headerItems(['https', 'framing']),
      siteResults: urlOnlyResults(),
    });
    const items = buildRoadmap(inputOf(f)).items.filter((i) => i.kind === 'improve-header');
    expect(items.map((i) => i.refs.evidenceIds![0])).toEqual([
      'ev_site_tls-headers_1', // https: high
      'ev_site_tls-headers_5', // framing: low
    ]);
    expect(items.map((i) => i.severity)).toEqual(['high', 'low']);
  });

  it('header severities: https high, HSTS and CSP medium, nosniff and framing low, referrer info', () => {
    const subjects = [
      'https',
      'strict-transport-security',
      'content-security-policy',
      'x-content-type-options',
      'framing',
      'referrer-policy',
    ];
    const f = makeFixture({
      provided: { supabase: false, website: true },
      siteEvidence: headerItems(subjects),
      siteResults: urlOnlyResults(),
    });
    const bySubject = new Map(
      buildRoadmap(inputOf(f)).items
        .filter((i) => i.kind === 'improve-header')
        .map((i) => [i.refs.evidenceIds![0], i.severity]),
    );
    expect([...bySubject.values()].sort()).toEqual(
      ['high', 'info', 'low', 'low', 'medium', 'medium'],
    );
    expect(bySubject.get('ev_site_tls-headers_1')).toBe('high');
    expect(bySubject.get('ev_site_tls-headers_6')).toBe('info');
  });

  it('the secret-key item says: rotate (Supabase -> API keys), remove from code/env, redeploy, run again', () => {
    const item = buildRoadmap(inputOf(urlOnly())).items[0];
    expect(item.kind).toBe('fix-site-secret');
    expect(item.steps.length).toBeGreaterThanOrEqual(1);
    expect(item.steps.length).toBeLessThanOrEqual(4);
    const en = item.steps.map((s) => s.en).join('\n');
    expect(en).toMatch(/rotate/i);
    expect(en).toMatch(/API keys/);
    expect(en).toMatch(/Supabase/);
    expect(en).toMatch(/remove/i);
    expect(en).toMatch(/code/i);
    expect(en).toMatch(/redeploy/i);
    expect(en).toMatch(/run .*again|re-run|run the audit/i);
    const ur = item.steps.map((s) => s.ur).join('\n');
    expect(ur).toMatch(/rotate/i);
    expect(ur).toMatch(/API keys/);
  });

  it('a script that was not read: the finish-check item names it; a failed check is finish-check too', () => {
    const items = buildRoadmap(inputOf(both())).items.filter((i) => i.kind === 'finish-check');
    const partial = items.find((i) => i.refs.checkId === 'bundle-secrets')!;
    expect(partial.severity).toBe('medium');
    expect(partial.why.en).toContain('www.example-shop.com/big.js');
    expect(partial.why.en).toContain('www.example-shop.com/slow.js');
    expect(partial.why.ur).toContain('www.example-shop.com/big.js');

    const failedToRun = makeFixture({
      provided: { supabase: false, website: true },
      siteResults: {
        'tls-headers': {
          id: 'tls-headers',
          status: 'failedToRun',
          reason: { en: 'The site could not be reached.', ur: 'Site tak pahunch nahi hui.' },
        },
        'bundle-secrets': {
          id: 'bundle-secrets',
          status: 'failedToRun',
          reason: { en: 'The site could not be reached.', ur: 'Site tak pahunch nahi hui.' },
        },
      },
    });
    const failed = buildRoadmap(inputOf(failedToRun)).items.filter((i) => i.kind === 'finish-check');
    expect(failed.map((i) => i.refs.checkId).sort()).toEqual(['bundle-secrets', 'tls-headers']);
    expect(failed.every((i) => i.severity === 'medium')).toBe(true);
  });

  it('"not provided" optional checks give a provide-input item (info, not from a required check)', () => {
    const items = buildRoadmap(inputOf(supabaseOnly())).items.filter(
      (i) => i.kind === 'provide-input',
    );
    expect(items.map((i) => i.refs.checkId).sort()).toEqual(['bundle-secrets', 'tls-headers']);
    for (const item of items) {
      expect(item.severity).toBe('info');
      expect(item.fromRequiredCheck).toBe(false);
    }
  });

  it('retest: only when there is a fix item AND Supabase was given', () => {
    // Supabase only, nothing to fix
    const clean = makeFixture({
      provided: { supabase: true, website: false },
      findings: [finding('fnd_001', 'profiles', 'BLOCKED')],
    });
    expect(buildRoadmap(inputOf(clean)).items.some((i) => i.kind === 'retest')).toBe(false);
    // confirm alone is not a fix
    const unclear = makeFixture({
      provided: { supabase: true, website: false },
      findings: [finding('fnd_001', 'hotels', 'INCONCLUSIVE')],
    });
    expect(buildRoadmap(inputOf(unclear)).items.some((i) => i.kind === 'retest')).toBe(false);
    // a fix item and Supabase: yes, exactly one
    expect(
      buildRoadmap(inputOf(supabaseOnly())).items.filter((i) => i.kind === 'retest'),
    ).toHaveLength(1);
    // a fix item but no Supabase: no
    expect(buildRoadmap(inputOf(urlOnly())).items.some((i) => i.kind === 'retest')).toBe(false);
  });
});

function urlOnlyResults() {
  return {
    'tls-headers': { id: 'tls-headers', status: 'completed' as const },
    'bundle-secrets': { id: 'bundle-secrets', status: 'completed' as const },
  };
}

describe('roadmap: the order is fixed', () => {
  const compare = (a: RoadmapItem, b: RoadmapItem) => {
    const sev = SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity);
    if (sev !== 0) return sev;
    if (a.fromRequiredCheck !== b.fromRequiredCheck) return a.fromRequiredCheck ? -1 : 1;
    return KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind);
  };

  it('every pair is in order: severity, then required checks first, then kind', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const { items } = buildRoadmap(inputOf(make()));
      for (let i = 1; i < items.length; i++) {
        expect(compare(items[i - 1], items[i])).toBeLessThanOrEqual(0);
      }
    }
  });

  it('ids are rm_001... in the sorted order', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const { items } = buildRoadmap(inputOf(make()));
      expect(items.map((i) => i.id)).toEqual(
        items.map((_, n) => `rm_${String(n + 1).padStart(3, '0')}`),
      );
    }
  });

  it('the same input in any order gives the same roadmap (20 shuffles of every fixture)', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const f = make();
      const expected = buildRoadmap(inputOf(f));
      for (let seed = 1; seed <= 20; seed++) {
        const input: RoadmapInput = {
          ...inputOf(f),
          findings: shuffled(f.findings, seed),
          evidence: shuffled(f.evidence, seed + 100),
          plan: shuffled(f.plan, seed + 200),
          coverage: {
            ...f.coverage,
            checked: shuffled(f.coverage.checked, seed),
            skipped: shuffled(f.coverage.skipped, seed + 1),
            failedToRun: shuffled(f.coverage.failedToRun, seed + 2),
            partial: shuffled(f.coverage.partial, seed + 3).map((p) => ({
              ...p,
              notRead: shuffled(p.notRead, seed + 4),
            })),
          },
        };
        expect(buildRoadmap(input)).toEqual(expected);
      }
    }
  });

  it('the same input twice gives the same roadmap (no time, no random)', () => {
    const f = both();
    expect(buildRoadmap(inputOf(f))).toEqual(buildRoadmap(inputOf(f)));
  });

  it('the ordering matrix: severity beats everything, required beats kind, kind beats the ref', () => {
    // critical leak vs critical secret: kind rank decides (secret first)
    const items = buildRoadmap(inputOf(both())).items;
    const first = items.filter((i) => i.severity === 'critical').map((i) => i.kind);
    expect(first).toEqual(['fix-site-secret', 'fix-finding']);
    expect(KIND_RANK.indexOf('fix-site-secret')).toBeLessThan(KIND_RANK.indexOf('fix-finding'));

    // same severity (low): a required check goes before an optional one, whatever the kind
    const f = makeFixture({
      provided: { supabase: true, website: true },
      findings: [finding('fnd_001', 'hotels', 'INCONCLUSIVE')], // confirm, low, required
      siteEvidence: headerItems(['x-content-type-options']), // improve-header, low
      siteResults: urlOnlyResults(),
    });
    const plan = f.plan.map((c) => (c.id === 'tls-headers' ? { ...c, required: false } : c));
    const low = buildRoadmap({ ...inputOf(f), plan }).items.filter((i) => i.severity === 'low');
    expect(low.map((i) => i.kind)).toEqual(['confirm', 'improve-header']);
    expect(low.map((i) => i.fromRequiredCheck)).toEqual([true, false]);
    // and with both required, the kind rank decides
    const both2 = buildRoadmap(inputOf(f)).items.filter((i) => i.severity === 'low');
    expect(both2.map((i) => i.kind)).toEqual(
      ['confirm', 'improve-header'].sort((a, b) => KIND_RANK.indexOf(a as never) - KIND_RANK.indexOf(b as never)),
    );
  });

  it('two items of the same kind and severity: the ref id decides (fnd_002 before fnd_010)', () => {
    const f = makeFixture({
      provided: { supabase: true, website: false },
      findings: [
        finding('fnd_010', 'c', 'LEAKED'),
        finding('fnd_002', 'a', 'LEAKED'),
        finding('fnd_003', 'b', 'LEAKED'),
      ],
    });
    const ids = buildRoadmap(inputOf(f)).items
      .filter((i) => i.kind === 'fix-finding')
      .map((i) => i.refs.findingIds![0]);
    expect(ids).toEqual(['fnd_002', 'fnd_003', 'fnd_010']);
  });
});

describe('roadmap: text and references', () => {
  it('every text has both languages, steps are 1 to 4, and a title and a reason are never empty', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      for (const item of buildRoadmap(inputOf(make())).items) {
        for (const t of [item.title, item.why, ...item.steps]) {
          expect(t.en.trim().length).toBeGreaterThan(0);
          expect(t.ur.trim().length).toBeGreaterThan(0);
        }
        expect(item.steps.length).toBeGreaterThanOrEqual(1);
        expect(item.steps.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('every reference points at something that exists', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const f = make();
      const { items } = buildRoadmap(inputOf(f));
      for (const item of items) {
        expect(f.plan.map((c) => c.id)).toContain(item.refs.checkId);
        for (const id of item.refs.findingIds ?? []) {
          expect(f.findings.map((x) => x.id)).toContain(id);
        }
        for (const id of item.refs.evidenceIds ?? []) {
          expect(f.evidence.map((x) => x.id)).toContain(id);
        }
      }
    }
  });

  it('no claim of approval in English or Roman Urdu (the wording rule)', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      for (const text of allStrings(buildRoadmap(inputOf(make())))) {
        expect(text).not.toMatch(BANNED_EN);
        expect(text).not.toMatch(BANNED_UR);
      }
    }
  });

  it('no key, no query, no address of the tested project: only host/path of a script', () => {
    const f = makeFixture({
      provided: { supabase: false, website: true },
      siteEvidence: [bundleItem(1, 'www.example-shop.com/assets/app.js')],
      siteResults: urlOnlyResults(),
    });
    const json = JSON.stringify(buildRoadmap(inputOf(f)));
    expect(json).not.toMatch(/sb_secret_|eyJ|\?\w+=|supabase\.co/);
  });
});

describe('roadmap: the cap', () => {
  it('at most 100 items; the rest is counted in truncated; ids stay rm_001..rm_100', () => {
    const findings = Array.from({ length: 130 }, (_, n) =>
      finding(`fnd_${String(n + 1).padStart(3, '0')}`, `t${n}`, 'LEAKED'),
    );
    const f = makeFixture({ provided: { supabase: true, website: false }, findings });
    const roadmap = buildRoadmap(inputOf(f));
    expect(ROADMAP_CAP).toBe(100);
    expect(roadmap.items).toHaveLength(100);
    // 130 fixes + 2 "provide" items + 1 re-test = 133 in all
    expect(roadmap.truncated).toBe(33);
    expect(roadmap.items[0].id).toBe('rm_001');
    expect(roadmap.items[99].id).toBe('rm_100');
    // the most important ones are kept: all 100 are fixes (critical)
    expect(roadmap.items.every((i) => i.kind === 'fix-finding')).toBe(true);
  });

  it('exactly 100 items: nothing is cut', () => {
    const findings = Array.from({ length: 97 }, (_, n) =>
      finding(`fnd_${String(n + 1).padStart(3, '0')}`, `t${n}`, 'LEAKED'),
    );
    const f = makeFixture({ provided: { supabase: true, website: false }, findings });
    const roadmap = buildRoadmap(inputOf(f)); // 97 + 2 + 1 = 100
    expect(roadmap.items).toHaveLength(100);
    expect(roadmap.truncated).toBe(0);
  });
});
