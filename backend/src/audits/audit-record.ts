import type { Finding } from '../prover/types.js';
import type { LockC } from '../stages/types.js';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface LastRetest {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  tablesAdded: string[];
  tablesRemoved: string[];
  error: { code: string; message: string } | null;
}

export interface ReportRow {
  status: AuditStatus;
  progress: number;
  message?: string;
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
   * Plan, evidence, coverage and gate of the latest finished run. Missing on an
   * audit that was stored before the stages existed.
   */
  lockC?: LockC;
}
