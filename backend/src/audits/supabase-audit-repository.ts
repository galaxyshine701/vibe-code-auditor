import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { timedFetch } from '../prover/timed-fetch.js';
import type { AuditRecord, AuditStatus } from './audit-record.js';
import {
  AuditStoreError,
  newVersion,
  type AuditRepository,
  type StoredAudit,
} from './audit-repository.js';
import type { PlatformConfig } from './platform-config.js';

const TABLE = 'vca_audits';
const COLUMNS = 'id,status,created_at,updated_at,version,run_id,record';
const STORE_TIMEOUT_MS = 10_000;
/** How many old rows one prune looks at (the store never holds many more than 50). */
const PRUNE_LOOK_AT = 500;

interface Row {
  id: string;
  status: AuditStatus;
  created_at: string;
  updated_at: string;
  version: string;
  run_id: string | null;
  record: AuditRecord;
}

const toStored = (row: Row): StoredAudit => ({
  id: row.id,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
  runId: row.run_id,
  record: row.record,
});

/**
 * The audit store in the platform's own Supabase project, through
 * @supabase/supabase-js. The table is public.vca_audits with RLS on and no
 * policy: only the platform's service key can reach it.
 *
 * Errors become AuditStoreError (fixed sentence + the short PostgREST code);
 * the library message is never passed on.
 */
export class SupabaseAuditRepository implements AuditRepository {
  readonly ownSecrets: readonly string[];
  private readonly client: SupabaseClient;

  constructor(config: PlatformConfig) {
    this.ownSecrets = [config.serviceKey];
    this.client = createClient(config.url, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { retry: false },
      global: { fetch: timedFetch(STORE_TIMEOUT_MS) },
    });
  }

  private fail(operation: string, error: unknown): never {
    if (error instanceof AuditStoreError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    throw new AuditStoreError(
      operation,
      typeof code === 'string' && /^[A-Za-z0-9_]{1,12}$/.test(code)
        ? code
        : undefined,
    );
  }

  async ping(): Promise<void> {
    try {
      const { error } = await this.client.from(TABLE).select('id').limit(1);
      if (error) this.fail('ping', error);
    } catch (error) {
      this.fail('ping', error);
    }
  }

  async insert(row: {
    id: string;
    status: AuditStatus;
    createdAt: string;
    runId: string;
    record: AuditRecord;
  }): Promise<void> {
    try {
      const { error } = await this.client.from(TABLE).insert({
        id: row.id,
        status: row.status,
        created_at: row.createdAt,
        updated_at: new Date().toISOString(),
        version: newVersion(),
        run_id: row.runId,
        record: row.record,
      });
      if (error) this.fail('insert', error);
    } catch (error) {
      this.fail('insert', error);
    }
  }

  async get(id: string): Promise<StoredAudit | null> {
    try {
      const { data, error } = await this.client
        .from(TABLE)
        .select(COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) this.fail('get', error);
      return data ? toStored(data as Row) : null;
    } catch (error) {
      this.fail('get', error);
    }
  }

  /** Runs a guarded update. true = one row changed, false = 0 rows. */
  private async guarded(
    operation: string,
    run: () => PromiseLike<{ data: { id: string }[] | null; error: unknown }>,
  ): Promise<boolean> {
    try {
      const { data, error } = await run();
      if (error) this.fail(operation, error);
      return (data?.length ?? 0) > 0;
    } catch (error) {
      this.fail(operation, error);
    }
  }

  writeRunning(
    id: string,
    runId: string,
    record: AuditRecord,
  ): Promise<boolean> {
    return this.guarded('write', () =>
      this.client
        .from(TABLE)
        .update({
          record,
          updated_at: new Date().toISOString(),
          version: newVersion(),
        })
        .eq('id', id)
        .eq('status', 'running')
        .eq('run_id', runId)
        .select('id'),
    );
  }

  finish(
    id: string,
    runId: string,
    status: 'completed' | 'failed',
    record: AuditRecord,
  ): Promise<boolean> {
    return this.guarded('finish', () =>
      this.client
        .from(TABLE)
        .update({
          status,
          record,
          updated_at: new Date().toISOString(),
          version: newVersion(),
        })
        .eq('id', id)
        .eq('status', 'running')
        .eq('run_id', runId)
        .select('id'),
    );
  }

  beginRetest(
    id: string,
    runId: string,
    record: AuditRecord,
  ): Promise<boolean> {
    return this.guarded('retest', () =>
      this.client
        .from(TABLE)
        .update({
          status: 'running',
          run_id: runId,
          record,
          updated_at: new Date().toISOString(),
          version: newVersion(),
        })
        .eq('id', id)
        .eq('status', 'completed')
        .select('id'),
    );
  }

  saveIdle(
    id: string,
    expectedVersion: string,
    record: AuditRecord,
  ): Promise<boolean> {
    return this.guarded('save', () =>
      this.client
        .from(TABLE)
        .update({
          record,
          updated_at: new Date().toISOString(),
          version: newVersion(),
        })
        .eq('id', id)
        .in('status', ['completed', 'failed'])
        .eq('version', expectedVersion)
        .select('id'),
    );
  }

  async prune(keep: number): Promise<void> {
    try {
      const { data, error } = await this.client
        .from(TABLE)
        .select('id,status')
        .order('created_at', { ascending: false })
        .range(keep, keep + PRUNE_LOOK_AT - 1);
      if (error) this.fail('prune', error);
      const ids = ((data ?? []) as { id: string; status: AuditStatus }[])
        .filter((row) => row.status !== 'running')
        .map((row) => row.id);
      if (ids.length === 0) return;
      const removed = await this.client
        .from(TABLE)
        .delete()
        .in('id', ids)
        .neq('status', 'running');
      if (removed.error) this.fail('prune', removed.error);
    } catch (error) {
      this.fail('prune', error);
    }
  }

  async listRunning(): Promise<StoredAudit[]> {
    try {
      const { data, error } = await this.client
        .from(TABLE)
        .select(COLUMNS)
        .eq('status', 'running');
      if (error) this.fail('list', error);
      return ((data ?? []) as Row[]).map(toStored);
    } catch (error) {
      this.fail('list', error);
    }
  }
}
