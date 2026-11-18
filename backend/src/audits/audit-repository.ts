import { randomBytes } from 'node:crypto';
import type { AuditRecord, AuditStatus } from './audit-record.js';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

/** A new random version token. Each write of a row makes one. */
export const newVersion = (): string => randomBytes(12).toString('hex');

/** One row of the audit store. */
export interface StoredAudit {
  id: string;
  status: AuditStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * A random text that every write replaces with a new one. It is compared as
   * plain text, never parsed: that is why it is used (and not updatedAt) to
   * tell whether somebody saved in between.
   */
  version: string;
  /** Which run owns the row while it is `running`. Only that run may write it. */
  runId: string | null;
  record: AuditRecord;
}

/**
 * A fixed-sentence error for every store failure. It never carries the text of
 * the library error (that text could quote an address or a key).
 */
export class AuditStoreError extends Error {
  constructor(operation: string, code?: string) {
    super(
      `The audit store could not be used (${operation}${code ? `, code ${code}` : ''}).`,
    );
    this.name = 'AuditStoreError';
  }
}

/**
 * Where audits are kept. Every "guarded" method returns false when 0 rows were
 * changed (the row is not in the state the caller expected). The caller must
 * then stop writing for that run.
 */
export interface AuditRepository {
  /** Secret values the store itself holds (to be redacted from every text). */
  readonly ownSecrets: readonly string[];
  /** Throws if the store cannot be used (no connection, table missing). */
  ping(): Promise<void>;
  /** Adds a new `running` row. Throws if it cannot. */
  insert(row: {
    id: string;
    status: AuditStatus;
    createdAt: string;
    runId: string;
    record: AuditRecord;
  }): Promise<void>;
  get(id: string): Promise<StoredAudit | null>;
  /** Guarded: only while status = 'running' AND run_id = runId. Status stays 'running'. */
  writeRunning(
    id: string,
    runId: string,
    record: AuditRecord,
  ): Promise<boolean>;
  /** Guarded like writeRunning. Sets the final status ('completed' or 'failed'). */
  finish(
    id: string,
    runId: string,
    status: 'completed' | 'failed',
    record: AuditRecord,
  ): Promise<boolean>;
  /** Guarded: only while status = 'completed'. Sets status 'running' and a new run id. */
  beginRetest(id: string, runId: string, record: AuditRecord): Promise<boolean>;
  /**
   * Guarded: only while status is 'completed' or 'failed' AND the version is
   * still the one that was read (nobody else wrote in between, not even a whole
   * run that started and ended). Used for "approve fix".
   */
  saveIdle(
    id: string,
    expectedVersion: string,
    record: AuditRecord,
  ): Promise<boolean>;
  /** Keeps the newest `keep` audits. A `running` row is never removed. */
  prune(keep: number): Promise<void>;
  /** Every row whose status is 'running'. */
  listRunning(): Promise<StoredAudit[]>;
}
