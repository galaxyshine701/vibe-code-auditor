import { describe, expect, it } from 'vitest';
import {
  createRoadmapAgent,
  ROADMAP_AGENT_ID,
} from '../../src/agents/roadmap-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import { buildRoadmap } from '../../src/stages/roadmap.js';
import { supabaseOnly, type StageFixture } from '../stages/roadmap-fixtures.js';

function contextOf(f: StageFixture): RunContext {
  return {
    provided: f.provided,
    plan: f.plan,
    evidence: f.evidence,
    coverage: f.coverage,
    stageInput: {
      findings: f.findings,
      cleanup: f.cleanup,
      dataAccess: { status: 'completed' },
      provided: f.provided,
    },
  };
}

describe('Roadmap agent', () => {
  it('is a finalizer (alwaysRun), not critical, with its own id', () => {
    const agent = createRoadmapAgent();
    expect(agent.id).toBe(ROADMAP_AGENT_ID);
    expect(ROADMAP_AGENT_ID).toBe('roadmap');
    expect(agent.alwaysRun).toBe(true);
    expect(agent.critical).toBe(false);
  });

  it('writes context.roadmap from the plan, evidence and coverage; changes nothing else', async () => {
    const f = supabaseOnly();
    const context = contextOf(f);
    const before = structuredClone({
      evidence: context.evidence,
      coverage: context.coverage,
      plan: context.plan,
    });
    const result = await createRoadmapAgent().run(context, () => undefined);
    expect(result).toBeUndefined();
    expect(context.roadmap).toEqual(
      buildRoadmap({
        plan: f.plan,
        findings: f.findings,
        evidence: f.evidence,
        coverage: f.coverage,
        cleanup: f.cleanup,
        provided: f.provided,
      }),
    );
    expect({
      evidence: context.evidence,
      coverage: context.coverage,
      plan: context.plan,
    }).toEqual(before);
    expect(context.lockC).toBeUndefined();
  });

  it('copies every text through the run redaction', async () => {
    const context = contextOf(supabaseOnly());
    await createRoadmapAgent().run(context, () => undefined, {
      shouldStop: () => false,
      redact: (text) => text.replaceAll('bookings', '<hidden>'),
      states: () => [],
      failure: () => null,
    });
    const json = JSON.stringify(context.roadmap);
    expect(json).not.toContain('bookings');
    expect(json).toContain('<hidden>');
  });

  it('no evidence (the Evidence step gave none): skipped with a reason, no roadmap', async () => {
    const context: RunContext = { provided: { supabase: true, website: false } };
    const result = await createRoadmapAgent().run(context, () => undefined);
    expect(result).toMatchObject({
      skipped: { en: expect.any(String), ur: expect.any(String) },
    });
    expect(context.roadmap).toBeUndefined();
  });
});
