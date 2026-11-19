import { describe, expect, it } from 'vitest';
import {
  AGENTS_OFF,
  resolveAgentsSetup,
} from '../../src/agents/agents-config.js';

describe('the deadline of the code-only stage agents', () => {
  it('is 5000 ms by default', () => {
    expect(AGENTS_OFF.finalizerDeadlineMs).toBe(5_000);
    expect(
      resolveAgentsSetup({ LOCK_C_AGENTS: 'on' }).setup.finalizerDeadlineMs,
    ).toBe(5_000);
  });

  it('comes from AGENT_FINALIZER_DEADLINE_MS, and a bad number is ignored with a warning', () => {
    const good = resolveAgentsSetup({ AGENT_FINALIZER_DEADLINE_MS: '250' });
    expect(good.setup.finalizerDeadlineMs).toBe(250);
    const bad = resolveAgentsSetup({ AGENT_FINALIZER_DEADLINE_MS: 'soon' });
    expect(bad.setup.finalizerDeadlineMs).toBe(5_000);
    expect(bad.warnings).toHaveLength(1);
    expect(bad.warnings[0]).not.toContain('soon');
  });

  it('is shorter than every other time limit', () => {
    const { setup } = resolveAgentsSetup({});
    expect(setup.finalizerDeadlineMs!).toBeLessThan(setup.reportDeadlineMs);
    expect(setup.finalizerDeadlineMs!).toBeLessThan(setup.proverDeadlineMs);
  });
});
