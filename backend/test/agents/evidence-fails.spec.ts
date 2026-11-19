import { describe, expect, it, vi } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { EVIDENCE_UNAVAILABLE } from '../../src/stages/failsafe.js';
import { runScenario } from './scenarios.js';

// The Evidence agent breaks. Everything else is the real code.
vi.mock('../../src/agents/evidence-agent.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/agents/evidence-agent.js')>();
  return {
    ...original,
    createEvidenceAgent: () => ({
      ...original.createEvidenceAgent(),
      run: () => Promise.reject(new Error('evidence broke')),
    }),
  };
});

const ON = { ...AGENTS_OFF, enabled: true };
type Row = { id: string; status: string; message?: string };

describe('flag on, the Evidence agent fails', () => {
  it('the audit is NOT failed; the gate is not_ready, for a stated reason; the Evidence row says it failed', async () => {
    const on = await runScenario('mixed', ON);
    expect(on.audit.status).toBe('completed');
    const gate = on.audit.gate as { decision: string; reasons: unknown[] };
    expect(gate.decision).toBe('not_ready');
    expect(gate.reasons[0]).toEqual(EVIDENCE_UNAVAILABLE);

    const rows = on.audit.modules as Row[];
    const evidence = rows.find((m) => m.id === 'evidence')!;
    expect([evidence.status, evidence.message]).toEqual([
      'failed',
      'evidence broke',
    ]);
    expect(rows.find((m) => m.id === 'guide')!.status).toBe('completed');
    // the findings themselves are untouched
    const summary = on.audit.summary as { leaked: number };
    expect(summary.leaked).toBe(1);
  });

  it('/evidence answers with no items and a coverage in which nothing is checked', async () => {
    const on = await runScenario('mixed', ON);
    const evidence = on.evidence as {
      items: unknown[];
      coverage: { checked: string[]; failedToRun: unknown[] };
    };
    expect(evidence.items).toEqual([]);
    expect(evidence.coverage.checked).toEqual([]);
    expect(evidence.coverage.failedToRun.length).toBeGreaterThan(0);
  });

  it('even a run with only BLOCKED tables is not ready without its evidence', async () => {
    const on = await runScenario('all-blocked', ON);
    expect((on.audit.gate as { decision: string }).decision).toBe('not_ready');
    expect(on.audit.status).toBe('completed');
  });

  it('the Prover failed AND Evidence failed: the audit is failed, the gate is not_ready', async () => {
    const on = await runScenario('prover-failed', ON);
    expect(on.audit.status).toBe('failed');
    expect((on.audit.gate as { decision: string }).decision).toBe('not_ready');
  });

  it('flag off does not use the Evidence agent at all', async () => {
    const off = await runScenario('mixed', AGENTS_OFF);
    expect((off.audit.modules as Row[]).map((m) => m.id)).toEqual([
      'data-access-prover',
    ]);
    expect((off.evidence as { items: unknown[] }).items.length).toBe(3);
  });
});
