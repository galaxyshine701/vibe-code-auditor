import { describe, expect, it } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { OWNERSHIP_NOT_CHECKED } from '../../src/stages/run-stages.js';
import {
  SCENARIOS,
  normalize,
  runScenario,
  type ScenarioName,
  type Snapshot,
} from './scenarios.js';

const ON = { ...AGENTS_OFF, enabled: true };
const STAGE_ROWS = ['planner', 'ownership', 'evidence', 'guide'];

type Row = { id: string; status: string; progress: number; reason?: unknown };
const modulesOf = (s: Snapshot) => s.audit.modules as Row[];

/** The same snapshot without the four rows of the stage agents. */
function withoutStageRows(s: Snapshot): unknown {
  const copy = structuredClone(s);
  copy.audit.modules = modulesOf(copy).filter(
    (m) => !STAGE_ROWS.includes(m.id),
  );
  return normalize(copy);
}

/**
 * Since "not provided" (a request without a websiteUrl has no website to
 * check) the flag-on answer to a Supabase-only request differs from the
 * flag-off one in exactly three places, on purpose:
 *   1. plan: tls-headers and bundle-secrets are required:false
 *   2. coverage.skipped: their reason is "Not provided ..." (not "Not implemented yet.")
 *   3. gate: it no longer waits for those two checks
 * Everything else is the same. This puts those three aside, then compares.
 */
const WEBSITE_CHECKS = ['tls-headers', 'bundle-secrets'];

type Loose = {
  audit: {
    plan: { id: string; required: boolean }[];
    gate?: unknown;
  };
  evidence: { coverage: { skipped: { id: string; reason: unknown }[] } };
};

function canon(s: Snapshot): unknown {
  const copy = withoutStageRows(s) as Loose;
  for (const check of copy.audit.plan) {
    if (WEBSITE_CHECKS.includes(check.id)) check.required = false;
  }
  for (const skipped of copy.evidence.coverage.skipped) {
    if (WEBSITE_CHECKS.includes(skipped.id)) skipped.reason = '<skipped>';
  }
  delete copy.audit.gate;
  return copy;
}

type Gate = { decision: string; reasons: { en: string; ur: string }[] };
const gateOf = (s: Snapshot) => s.audit.gate as Gate;

describe('flag on and flag off give the same answers (except the three places above)', () => {
  for (const name of SCENARIOS) {
    it(`scenario "${name}": ownership, evidence, findings, summary, cleanup and everything else are the same`, async () => {
      const off = await runScenario(name as ScenarioName, AGENTS_OFF);
      const on = await runScenario(name as ScenarioName, ON);
      expect(canon(on)).toEqual(canon(off));
      expect(modulesOf(on).length).toBe(modulesOf(off).length + 4);
    }, 30_000);
  }

  // The gate, scenario by scenario. A leak, a Prover that failed, or a cleanup
  // that failed keep it not_ready (as before). A run with nothing wrong and a
  // blocked table is ready now: the two website checks were not provided.
  const EXPECTED: Record<string, string> = {
    mixed: 'not_ready',
    'all-blocked': 'ready_by_these_checks',
    'prover-failed': 'not_ready',
    'retest-ok': 'ready_by_these_checks',
    'retest-failed': 'not_ready',
    'report-on': 'not_ready',
    'cleanup-failed': 'not_ready',
  };
  for (const name of SCENARIOS) {
    it(`scenario "${name}": the gate is ${EXPECTED[name]}`, async () => {
      const on = await runScenario(name as ScenarioName, ON);
      expect(gateOf(on).decision).toBe(EXPECTED[name]);
      if (EXPECTED[name] === 'ready_by_these_checks') {
        expect(gateOf(on).reasons).toEqual([]);
      } else if (name !== 'retest-failed') {
        // names the checks that were not provided, in both languages
        const reasons = gateOf(on).reasons;
        for (const title of [
          'Certificate and security headers of the site',
          'Secret keys inside the scripts of the site',
        ]) {
          expect(reasons.some((r) => r.en.includes(title))).toBe(true);
        }
        for (const r of reasons) expect(r.ur.length).toBeGreaterThan(0);
      }
    }, 30_000);
  }

  it('the gate of flag off is still the old one: never ready, because the two checks are required and not built', async () => {
    for (const name of SCENARIOS) {
      const off = await runScenario(name as ScenarioName, AGENTS_OFF);
      expect(gateOf(off).decision).toBe('not_ready');
    }
  }, 60_000);
});

describe('flag on: the rows of the stage agents', () => {
  it('a normal run: planner, evidence and guide completed; ownership skipped with its reason', async () => {
    const on = await runScenario('mixed', ON);
    const rows = modulesOf(on);
    expect(rows.map((m) => m.id)).toEqual([
      'data-access-prover',
      'planner',
      'ownership',
      'evidence',
      'guide',
    ]);
    const byId = Object.fromEntries(rows.map((m) => [m.id, m]));
    expect([byId.planner.status, byId.planner.progress]).toEqual([
      'completed',
      100,
    ]);
    expect([byId.evidence.status, byId.guide.status]).toEqual([
      'completed',
      'completed',
    ]);
    expect([byId.ownership.status, byId.ownership.progress]).toEqual([
      'skipped',
      0,
    ]);
    expect(byId.ownership.reason).toEqual(OWNERSHIP_NOT_CHECKED.reason);
    expect(on.audit.status).toBe('completed');
  });

  it('the Report agent row (when it is on) comes before the stage rows', async () => {
    const on = await runScenario('report-on', ON);
    expect(modulesOf(on).map((m) => m.id)).toEqual([
      'data-access-prover',
      'report-agent',
      'planner',
      'ownership',
      'evidence',
      'guide',
    ]);
  });

  it('the Prover failed: the audit is failed, Evidence and Guide still ran, the gate is not_ready', async () => {
    const on = await runScenario('prover-failed', ON);
    const byId = Object.fromEntries(modulesOf(on).map((m) => [m.id, m]));
    expect(on.audit.status).toBe('failed');
    expect(byId['data-access-prover'].status).toBe('failed');
    expect([byId.evidence.status, byId.guide.status]).toEqual([
      'completed',
      'completed',
    ]);
    expect((on.audit.gate as { decision: string }).decision).toBe('not_ready');
  });

  it('a failed re-test leaves the audit completed and its old stage result in place', async () => {
    const off = await runScenario('retest-failed', AGENTS_OFF);
    const on = await runScenario('retest-failed', ON);
    expect(on.audit.status).toBe('completed');
    // the stage result of the first audit stays: its leak keeps the gate not_ready
    expect(gateOf(on).decision).toBe(gateOf(off).decision);
    expect(gateOf(on).decision).toBe('not_ready');
    expect(normalize((on.evidence as { items: unknown }).items)).toEqual(
      normalize((off.evidence as { items: unknown }).items),
    );
  });

  it('a re-test works on the merged findings: the evidence uses the same finding ids as /findings', async () => {
    const on = await runScenario('retest-ok', ON);
    const ids = (on.findings as { findings: { id: string }[] }).findings.map(
      (f) => f.id,
    );
    const evidenceIds = (
      on.evidence as { items: { findingId: string }[] }
    ).items.map((e) => e.findingId);
    expect(evidenceIds).toEqual(ids);
  });
});

describe('flag off: no stage agent row, ever', () => {
  it('modules has only the rows it always had', async () => {
    for (const name of [
      'mixed',
      'prover-failed',
      'report-on',
    ] as ScenarioName[]) {
      const off = await runScenario(name, AGENTS_OFF);
      for (const id of STAGE_ROWS) {
        expect(modulesOf(off).map((m) => m.id)).not.toContain(id);
      }
    }
  });
});
