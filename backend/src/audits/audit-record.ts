import type { Finding } from '../prover/types.js';
import type { LockC, Text } from '../stages/types.js';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface LastRetest {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  tablesAdded: string[];
  tablesRemoved: string[];
  error: { code: string; message: string } | null;
}

/**
 * One agent row of an audit. `skipped` exists only for a row (never for the
 * audit): the agent did not run on purpose, and `reason` says why.
 */
export interface ReportRow {
  status: AuditStatus | 'skipped';
  progress: number;
  message?: string;
  reason?: Text;
}

/**
 * One audit, as it is kept in the audit store (the `record` column).
 * There is deliberately NO field for a key here, so a key cannot end up in a
 * response or in the database by accident. The run id is not part of it: it
 * has its own column.
 */
export interface AuditRecord {
  id: string;
  status: AuditStatus;
  createdAt: string;
  label: string;
  projectUrl: string;
  progress: number;
  findings: Finding[];
  cleanup: 'ok' | 'failed' | null;
  /** Only when cleanup failed: what to remove by hand. */
  cleanupNote: string | null;
  error: { code: string; message: string } | null;
  /** when the latest completed run (the audit or a successful re-test) finished */
  completedAt: string | null;
  /** the next finding number to hand out; a number is never used twice */
  nextFindingNumber: number;
  lastRetest: LastRetest | null;
  /** The Prover has finished (used while the Report agent is still working). */
  proverDone: boolean;
  /** The Report agent's row. null when the Report agent is off. */
  reportRow: ReportRow | null;
  /**
   * The rows of the agents added by LOCK_C_AGENTS, by agent id (name + row).
   * Missing when the flag is off.
   */
  moduleRows?: Record<string, ReportRow & { name: string }>;
  /**
   * Plan, evidence, coverage and gate of the latest finished run. Missing on an
   * audit that was stored before the stages existed.
   */
  lockC?: LockC;
}
