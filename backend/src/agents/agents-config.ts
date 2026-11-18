export const AGENTS_SETUP = Symbol('AGENTS_SETUP');

/**
 * How the agent pipeline is set up. Built once from the environment.
 * `enabled` is the LOCK_C_AGENTS flag. While it is off nothing below is used
 * and the audit behaves exactly as before.
 */
export interface AgentsSetup {
  enabled: boolean;
  /**
   * Time limit of the Data Access Prover. The Prover is never abandoned at
   * once (it must remove its temporary users): at the limit its stop flag goes
   * up, and `proverGraceMs` is how long the pipeline still waits for it.
   */
  proverDeadlineMs: number;
  proverGraceMs: number;
  /** Time limit of the Report agent (its own AI budget is 45 s, see limits.ts). */
  reportDeadlineMs: number;
  /** The whole run. At this time every agent is told to stop. */
  auditWatchdogMs: number;
  /**
   * When the Prover was given up on it may still be running. The project stays
   * held (no new audit of it) until it ends, but never longer than this.
   */
  orphanHoldMs: number;
  /**
   * Time limit of each code-only stage agent (Planner, Ownership, Evidence,
   * Guide). Short on purpose: Evidence and Guide still run after a failure or a
   * stop, so they must never be able to keep a finished run waiting. Optional
   * in the type (the default is used when it is missing).
   */
  finalizerDeadlineMs?: number;
}

export const AGENTS_OFF: AgentsSetup = {
  enabled: false,
  proverDeadlineMs: 300_000,
  proverGraceMs: 30_000,
  reportDeadlineMs: 60_000,
  auditWatchdogMs: 420_000,
  orphanHoldMs: 600_000,
  finalizerDeadlineMs: 5_000,
};

const NUMBER_VARS: [keyof AgentsSetup, string][] = [
  ['proverDeadlineMs', 'AGENT_PROVER_DEADLINE_MS'],
  ['proverGraceMs', 'AGENT_PROVER_GRACE_MS'],
  ['reportDeadlineMs', 'AGENT_REPORT_DEADLINE_MS'],
  ['auditWatchdogMs', 'AUDIT_WATCHDOG_MS'],
  ['orphanHoldMs', 'AGENT_ORPHAN_HOLD_MS'],
  ['finalizerDeadlineMs', 'AGENT_FINALIZER_DEADLINE_MS'],
];

/**
 * LOCK_C_AGENTS=on|off (default off). The times can be changed with
 * AGENT_PROVER_DEADLINE_MS, AGENT_PROVER_GRACE_MS, AGENT_REPORT_DEADLINE_MS,
 * AUDIT_WATCHDOG_MS and AGENT_ORPHAN_HOLD_MS (whole milliseconds, more than 0). Warnings are fixed
 * sentences: no value is printed.
 */
export function resolveAgentsSetup(env: NodeJS.ProcessEnv): {
  setup: AgentsSetup;
  warnings: string[];
} {
  const warnings: string[] = [];
  const raw = (env.LOCK_C_AGENTS ?? '').trim().toLowerCase();
  const setup: AgentsSetup = { ...AGENTS_OFF, enabled: raw === 'on' };
  if (raw !== '' && raw !== 'on' && raw !== 'off') {
    warnings.push('LOCK_C_AGENTS must be "on" or "off". It is off.');
  }
  for (const [key, name] of NUMBER_VARS) {
    const text = (env[name] ?? '').trim();
    if (text === '') continue;
    const value = Number(text);
    if (Number.isInteger(value) && value > 0) {
      (setup[key] as number) = value;
    } else {
      warnings.push(
        `${name} must be a whole number above 0. The default is used.`,
      );
    }
  }
  return { setup, warnings };
}
