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

describe('flag on and flag off give the same answers', () => {
  for (const name of SCENARIOS) {
    it(`scenario "${name}": plan, ownership, evidence, coverage, gate and everything else are the same`, async () => {
      const off = await runScenario(name as ScenarioName, AGENTS_OFF);
      const on = await runScenario(name as ScenarioName, ON);
      // the only difference is the four extra rows in `modules`
      expect(withoutStageRows(on)).toEqual(normalize(off));
      expect(modulesOf(on).length).toBe(modulesOf(off).length + 4);
    }, 30_000);
  }
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
    expect(normalize(on.audit.gate)).toEqual(normalize(off.audit.gate));
    expect(normalize(on.evidence)).toEqual(normalize(off.evidence));
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
