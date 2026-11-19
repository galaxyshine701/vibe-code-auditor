import { describe, expect, it } from 'vitest';
import {
  ROADMAP_NOT_AVAILABLE,
  buildClientReport,
  failSafeClientReport,
} from '../../src/stages/client-report.js';
import { GATE_UNAVAILABLE } from '../../src/stages/failsafe.js';
import { buildRoadmap } from '../../src/stages/roadmap.js';
import {
  ALL_FIXTURES,
  BANNED_EN,
  BANNED_UR,
  allStrings,
  both,
  finding,
  makeFixture,
  proverFailed,
  supabaseOnly,
  urlOnly,
  type StageFixture,
} from './roadmap-fixtures.js';

function reportOf(f: StageFixture, withRoadmap = true) {
  const roadmap = buildRoadmap({
    plan: f.plan,
    findings: f.findings,
    evidence: f.evidence,
    coverage: f.coverage,
    cleanup: f.cleanup,
    provided: f.provided,
  });
  return {
    roadmap,
    report: buildClientReport({
      plan: f.plan,
      evidence: f.evidence,
      coverage: f.coverage,
      gate: f.gate,
      roadmap: withRoadmap ? roadmap : null,
    }),
  };
}

describe('client report: the headline', () => {
  it('a leak in a table: says so, with the count, "by these checks"', () => {
    const { report } = reportOf(supabaseOnly());
    expect(report.headline.en).toMatch(/leak/i);
    expect(report.headline.en).toContain('by these checks');
    expect(report.headline.en).toMatch(/1 table/);
    expect(report.headline.ur.length).toBeGreaterThan(0);
  });

  it('a secret key in a script: says so', () => {
    const { report } = reportOf(urlOnly());
    expect(report.headline.en).toMatch(/leak/i);
    expect(report.headline.en).toMatch(/1 secret key/);
    expect(report.headline.en).toContain('by these checks');
  });

  it('table and site leaks together: both are named (summary.leaked is not the headline alone)', () => {
    const { report } = reportOf(both());
    expect(report.headline.en).toMatch(/1 table/);
    expect(report.headline.en).toMatch(/1 secret key/);
  });

  it('a site leak with zero table leaks is still a leak headline', () => {
    const f = urlOnly();
    expect(f.findings.filter((x) => x.verdict === 'LEAKED')).toHaveLength(0);
    expect(reportOf(f).report.headline.en).toMatch(/leak/i);
  });

  it('ready: "No leak found by these checks"', () => {
    const f = makeFixture({
      provided: { supabase: true, website: false },
      findings: [finding('fnd_001', 'profiles', 'BLOCKED')],
    });
    expect(f.gate.decision).toBe('ready_by_these_checks');
    const { report } = reportOf(f);
    expect(report.headline.en).toBe('No leak found by these checks.');
    expect(report.decision).toBe('ready_by_these_checks');
    expect(report.reasons).toEqual([]);
  });

  it('not ready and no leak: not complete; and it never says "no leak found" as if it were final', () => {
    const f = makeFixture({
      provided: { supabase: true, website: false },
      findings: [finding('fnd_001', 'hotels', 'INCONCLUSIVE')],
    });
    expect(f.gate.decision).toBe('not_ready');
    const { report } = reportOf(f);
    expect(report.headline.en).toMatch(/not complete/i);
    expect(report.headline.en).toContain('by these checks');
  });

  it('nothing finished: "No result"', () => {
    const { report } = reportOf(proverFailed());
    expect(report.headline.en).toMatch(/^No result/);
    expect(report.headline.en).toContain('by these checks');
  });

  it('the four situations give four different headlines', () => {
    const ready = makeFixture({
      provided: { supabase: true, website: false },
      findings: [finding('fnd_001', 'profiles', 'BLOCKED')],
    });
    const open = makeFixture({
      provided: { supabase: true, website: false },
      findings: [finding('fnd_001', 'hotels', 'INCONCLUSIVE')],
    });
    const headlines = [ready, open, supabaseOnly(), proverFailed()].map(
      (f) => reportOf(f).report.headline.en,
    );
    expect(new Set(headlines).size).toBe(4);
  });
});

describe('client report: the rest of the shape', () => {
  it('has exactly these fields, schemaVersion 1', () => {
    const { report } = reportOf(supabaseOnly());
    expect(Object.keys(report).sort()).toEqual(
      [
        'decision',
        'disclaimer',
        'findings',
        'headline',
        'limits',
        'reasons',
        'schemaVersion',
        'scope',
        'topActions',
      ].sort(),
    );
    expect(report.schemaVersion).toBe(1);
    expect(Object.keys(report.scope).sort()).toEqual(
      ['checked', 'failedToRun', 'notImplemented', 'notProvided', 'outOfScope', 'partial'].sort(),
    );
  });

  it('decision and reasons are the gate, copied', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const f = make();
      const { report } = reportOf(f);
      expect(report.decision).toBe(f.gate.decision);
      expect(report.reasons).toEqual(f.gate.reasons);
    }
  });

  it('the counts are the counts of the summary (tables) and of the evidence (site)', () => {
    const f = supabaseOnly();
    const count = (v: string) => f.findings.filter((x) => x.verdict === v).length;
    expect(reportOf(f).report.findings).toEqual({
      tables: { leaked: count('LEAKED'), blocked: count('BLOCKED'), inconclusive: count('INCONCLUSIVE') },
      site: null,
    });
    const u = urlOnly();
    expect(reportOf(u).report.findings).toEqual({
      tables: null,
      site: { siteLeaked: 1, headersMissing: 4 },
    });
    const b = both();
    expect(reportOf(b).report.findings).toEqual({
      tables: { leaked: 1, blocked: 1, inconclusive: 0 },
      site: { siteLeaked: 1, headersMissing: 1 },
    });
  });

  it('tables is null when the data check did not complete (not zero)', () => {
    expect(reportOf(proverFailed()).report.findings.tables).toBeNull();
  });

  it('the buckets are separate: every planned check is in exactly one', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const f = make();
      const { scope } = reportOf(f).report;
      const ids = [
        ...scope.checked,
        ...scope.notProvided,
        ...scope.notImplemented,
        ...scope.partial,
        ...scope.failedToRun,
      ].map((e) => e.id);
      expect([...ids].sort()).toEqual(f.plan.map((c) => c.id).sort());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('Supabase only: the website checks are "not provided", active checks "not implemented"', () => {
    const { scope } = reportOf(supabaseOnly()).report;
    expect(scope.checked.map((e) => e.id)).toEqual(['data-access-prover']);
    expect(scope.notProvided.map((e) => e.id).sort()).toEqual(['bundle-secrets', 'tls-headers']);
    expect(scope.notImplemented.map((e) => e.id)).toEqual(['active-checks']);
    expect(scope.partial).toEqual([]);
    expect(scope.failedToRun).toEqual([]);
  });

  it('both: a script that was not read is partial, and the other origin is out of scope', () => {
    const { scope } = reportOf(both()).report;
    expect(scope.partial.map((e) => e.id)).toEqual(['bundle-secrets']);
    expect(scope.outOfScope.map((o) => o.name)).toContain('cdn.other.com/lib.js');
    for (const entry of [...scope.checked, ...scope.partial]) {
      expect(entry.title.en.length).toBeGreaterThan(0);
      expect(entry.title.ur.length).toBeGreaterThan(0);
    }
  });

  it('a failed check is failedToRun, not "checked"', () => {
    const { scope } = reportOf(proverFailed()).report;
    expect(scope.failedToRun.map((e) => e.id)).toEqual(['data-access-prover']);
    expect(scope.checked).toEqual([]);
  });

  it('topActions are the first three roadmap ids; fewer when the roadmap is short', () => {
    const { roadmap, report } = reportOf(both());
    expect(roadmap.items.length).toBeGreaterThan(3);
    expect(report.topActions).toEqual(['rm_001', 'rm_002', 'rm_003']);
    const short = reportOf(
      makeFixture({
        provided: { supabase: true, website: false },
        findings: [finding('fnd_001', 'profiles', 'BLOCKED')],
      }),
    );
    expect(short.report.topActions).toEqual(short.roadmap.items.slice(0, 3).map((i) => i.id));
  });

  it('limits are the limits of the coverage; the disclaimer says "by these checks" and is in both languages', () => {
    const f = supabaseOnly();
    const { report } = reportOf(f);
    expect(report.limits).toEqual(f.coverage.limits);
    expect(report.disclaimer.en).toContain('by these checks');
    expect(report.disclaimer.ur.length).toBeGreaterThan(0);
  });

  it('every text has both languages', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const { report } = reportOf(make());
      for (const t of [report.headline, report.disclaimer, ...report.reasons, ...report.limits]) {
        expect(t.en.trim().length).toBeGreaterThan(0);
        expect(t.ur.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('client report: the wording rule', () => {
  it('no claim of approval in English or Roman Urdu, in any fixture (report and roadmap)', () => {
    for (const make of [...Object.values(ALL_FIXTURES)]) {
      const { roadmap, report } = reportOf(make());
      for (const text of [...allStrings(report), ...allStrings(roadmap)]) {
        expect(text).not.toMatch(BANNED_EN);
        expect(text).not.toMatch(BANNED_UR);
      }
    }
  });

  it('the fail-safe report follows the rule too', () => {
    for (const text of allStrings(failSafeClientReport())) {
      expect(text).not.toMatch(BANNED_EN);
      expect(text).not.toMatch(BANNED_UR);
    }
  });
});

describe('client report: the roadmap is not available', () => {
  it('no roadmap: no top actions, and the fixed sentence is in the limits', () => {
    const { report } = reportOf(supabaseOnly(), false);
    expect(report.topActions).toEqual([]);
    expect(report.limits.at(-1)).toEqual(ROADMAP_NOT_AVAILABLE);
    expect(ROADMAP_NOT_AVAILABLE.en).toBe('Roadmap not available.');
    // the rest is as before
    expect(report.decision).toBe(reportOf(supabaseOnly()).report.decision);
    expect(report.findings).toEqual(reportOf(supabaseOnly()).report.findings);
  });

  it('the fail-safe report (the Guide itself broke): not_ready, fixed reason, nothing counted', () => {
    const report = failSafeClientReport();
    expect(report.schemaVersion).toBe(1);
    expect(report.decision).toBe('not_ready');
    expect(report.reasons).toEqual([GATE_UNAVAILABLE]);
    expect(report.findings).toEqual({ tables: null, site: null });
    expect(report.topActions).toEqual([]);
    expect(report.limits).toEqual([ROADMAP_NOT_AVAILABLE]);
    expect(report.headline.en).toMatch(/^No result/);
    expect(report.scope).toEqual({
      checked: [],
      notProvided: [],
      notImplemented: [],
      partial: [],
      failedToRun: [],
      outOfScope: [],
    });
  });
});
