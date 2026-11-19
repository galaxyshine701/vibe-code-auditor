import { describe, expect, it } from 'vitest';
import {
  AGENTS_OFF,
  resolveAgentsSetup,
} from '../../src/agents/agents-config.js';

describe('resolveAgentsSetup', () => {
  it('is off by default', () => {
    const { setup, warnings } = resolveAgentsSetup({});
    expect(setup.enabled).toBe(false);
    expect(setup).toEqual(AGENTS_OFF);
    expect(warnings).toEqual([]);
  });

  it('is off for "off" and for any other word, and the other word gets a warning', () => {
    expect(resolveAgentsSetup({ LOCK_C_AGENTS: 'off' }).setup.enabled).toBe(
      false,
    );
    const odd = resolveAgentsSetup({ LOCK_C_AGENTS: 'yes please' });
    expect(odd.setup.enabled).toBe(false);
    expect(odd.warnings).toHaveLength(1);
    expect(odd.warnings[0]).not.toContain('yes please');
  });

  it('is on only for "on" (any case)', () => {
    expect(resolveAgentsSetup({ LOCK_C_AGENTS: ' ON ' }).setup.enabled).toBe(
      true,
    );
  });

  it('has sane default times: deadlines are shorter than the audit watchdog', () => {
    const { setup } = resolveAgentsSetup({ LOCK_C_AGENTS: 'on' });
    expect(setup.proverDeadlineMs).toBeGreaterThan(0);
    expect(setup.reportDeadlineMs).toBeGreaterThan(0);
    expect(setup.proverGraceMs).toBeGreaterThan(0);
    expect(setup.orphanHoldMs).toBe(600_000); // 10 minutes
    expect(setup.auditWatchdogMs).toBeGreaterThan(setup.proverDeadlineMs);
  });

  it('takes the times from the environment, and ignores a bad number with a warning', () => {
    const { setup, warnings } = resolveAgentsSetup({
      LOCK_C_AGENTS: 'on',
      AGENT_PROVER_DEADLINE_MS: '1234',
      AGENT_REPORT_DEADLINE_MS: 'abc',
      AUDIT_WATCHDOG_MS: '-5',
      AGENT_ORPHAN_HOLD_MS: '90000',
    });
    expect(setup.orphanHoldMs).toBe(90_000);
    expect(setup.proverDeadlineMs).toBe(1234);
    expect(setup.reportDeadlineMs).toBeGreaterThan(0);
    expect(setup.auditWatchdogMs).toBeGreaterThan(0);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).not.toContain('abc');
  });
});
