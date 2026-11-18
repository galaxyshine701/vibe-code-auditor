import type {
  AuditRecord,
  AuditStatus,
} from '../../src/audits/audit-record.js';
import {
  AuditStoreError,
  newVersion,
  type AuditRepository,
  type StoredAudit,
} from '../../src/audits/audit-repository.js';

type Operation =
  | 'ping'
  | 'insert'
  | 'get'
  | 'writeRunning'
  | 'finish'
  | 'beginRetest'
  | 'saveIdle'
  | 'prune'
  | 'listRunning';

/**
 * The audit store in memory, for tests. It behaves like the real table: it
 * keeps copies (like a jsonb column), and every guarded method changes a row
 * only when the guard holds, and says false (0 rows) otherwise.
 */
export class InMemoryAuditRepository implements AuditRepository {
  readonly ownSecrets: readonly string[];
  readonly rows = new Map<string, StoredAudit>();
  /** every operation that was called, in order */
  readonly calls: Operation[] = [];
  private readonly failures = new Map<Operation, number>();
  /** how many guarded writes changed 0 rows (a late or foreign write) */
  refused = 0;
  private clock = 0;

  constructor(ownSecrets: readonly string[] = []) {
    this.ownSecrets = ownSecrets;
  }

  /** The next `times` calls of `operation` throw (the store is unreachable). */
  failNext(operation: Operation, times = 1): void {
    this.failures.set(operation, times);
  }

  /** Makes every call of `operation` throw until `failNext(operation, 0)`. */
  failAlways(operation: Operation): void {
    this.failures.set(operation, Number.POSITIVE_INFINITY);
  }

  private enter(operation: Operation): void {
    this.calls.push(operation);
    const left = this.failures.get(operation) ?? 0;
    if (left > 0) {
      this.failures.set(operation, left - 1);
      throw new AuditStoreError(operation);
    }
  }

  /** Strictly increasing, so "updated_at changed" can always be told apart. */
  private now(): string {
    this.clock += 1;
    // like PostgREST: six fractional digits and +00:00 (not a JavaScript ISO string)
    return new Date(Date.UTC(2026, 10, 17, 0, 0, 0, 0) + this.clock)
      .toISOString()
      .replace('Z', '456+00:00');
  }

  private copy<T>(value: T): T {
    return structuredClone(value);
  }

  ping(): Promise<void> {
    this.enter('ping');
    return Promise.resolve();
  }

  insert(row: {
    id: string;
    status: AuditStatus;
    createdAt: string;
    runId: string;
    record: AuditRecord;
  }): Promise<void> {
    this.enter('insert');
    if (this.rows.has(row.id)) throw new AuditStoreError('insert', '23505');
    this.rows.set(row.id, {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: this.now(),
      version: newVersion(),
      runId: row.runId,
      record: this.copy(row.record),
    });
    return Promise.resolve();
  }

  get(id: string): Promise<StoredAudit | null> {
    this.enter('get');
    const row = this.rows.get(id);
    return Promise.resolve(row ? this.copy(row) : null);
  }

  writeRunning(
    id: string,
    runId: string,
    record: AuditRecord,
  ): Promise<boolean> {
    this.enter('writeRunning');
    const row = this.rows.get(id);
    if (!row || row.status !== 'running' || row.runId !== runId) {
      this.refused += 1;
      return Promise.resolve(false);
    }
    row.record = this.copy(record);
    row.updatedAt = this.now();
    row.version = newVersion();
    return Promise.resolve(true);
  }

  finish(
    id: string,
    runId: string,
    status: 'completed' | 'failed',
    record: AuditRecord,
  ): Promise<boolean> {
    this.enter('finish');
    const row = this.rows.get(id);
    if (!row || row.status !== 'running' || row.runId !== runId) {
      this.refused += 1;
      return Promise.resolve(false);
    }
    row.status = status;
    row.record = this.copy(record);
    row.updatedAt = this.now();
    row.version = newVersion();
    return Promise.resolve(true);
  }

  beginRetest(
    id: string,
    runId: string,
    record: AuditRecord,
  ): Promise<boolean> {
    this.enter('beginRetest');
    const row = this.rows.get(id);
    if (!row || row.status !== 'completed') return Promise.resolve(false);
    row.status = 'running';
    row.runId = runId;
    row.record = this.copy(record);
    row.updatedAt = this.now();
    row.version = newVersion();
    return Promise.resolve(true);
  }

  saveIdle(
    id: string,
    expectedVersion: string,
    record: AuditRecord,
  ): Promise<boolean> {
    this.enter('saveIdle');
    const row = this.rows.get(id);
    if (
      !row ||
      (row.status !== 'completed' && row.status !== 'failed') ||
      row.version !== expectedVersion
    ) {
      return Promise.resolve(false);
    }
    row.record = this.copy(record);
    row.updatedAt = this.now();
    row.version = newVersion();
    return Promise.resolve(true);
  }

  prune(keep: number): Promise<void> {
    this.enter('prune');
    const newestFirst = [...this.rows.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    for (const row of newestFirst.slice(keep)) {
      if (row.status !== 'running') this.rows.delete(row.id);
    }
    return Promise.resolve();
  }

  listRunning(): Promise<StoredAudit[]> {
    this.enter('listRunning');
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.status === 'running')
        .map((row) => this.copy(row)),
    );
  }
}
