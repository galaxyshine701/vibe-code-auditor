import { describe, expect, it } from 'vitest';
import {
  AGENTS_OFF,
  resolveAgentsSetup,
} from '../../src/agents/agents-config.js';

describe('the deadline of the website inspectors', () => {
  it('is 60000 ms by default', () => {
    expect(AGENTS_OFF.inspectorDeadlineMs).toBe(60_000);
    expect(resolveAgentsSetup({}).setup.inspectorDeadlineMs).toBe(60_000);
  });

  it('comes from AGENT_INSPECTOR_DEADLINE_MS; a bad number is ignored with a warning', () => {
    expect(
      resolveAgentsSetup({ AGENT_INSPECTOR_DEADLINE_MS: '1500' }).setup
        .inspectorDeadlineMs,
    ).toBe(1_500);
    const bad = resolveAgentsSetup({ AGENT_INSPECTOR_DEADLINE_MS: '-1' });
    expect(bad.setup.inspectorDeadlineMs).toBe(60_000);
    expect(bad.warnings).toHaveLength(1);
  });

  it('is shorter than the audit watchdog', () => {
    const { setup } = resolveAgentsSetup({});
    expect(setup.inspectorDeadlineMs!).toBeLessThan(setup.auditWatchdogMs);
  });
});
