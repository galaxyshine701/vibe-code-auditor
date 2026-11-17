import type { AuditRecord } from './audit-record.js';
import type { AuditRepository } from './audit-repository.js';
import { redactForStorage } from './redact-for-storage.js';

export const INTERRUPTED = 'INTERRUPTED';

export const INTERRUPTED_CLEANUP_NOTE =
  'The run was stopped by a server restart. Test users with an email like vca-*@example.com, or canary rows, may be left in the target project. Remove them by hand (Authentication > Users in Supabase, and rows with the value vca-canary).';

/**
 * Turns one row that was left `running` into its final state. Pure: it only
 * builds the new record and the new status.
 *
 * - An audit (no re-test going on): `failed`, error.code INTERRUPTED.
 * - A re-test (lastRetest.status = running): the AUDIT goes back to `completed`
 *   with its old findings untouched, and lastRetest becomes `failed` with
 *   error.code INTERRUPTED. The top-level `error` stays absent.
 * Either way the test project may hold leftovers, so cleanup is `failed` with
 * a generic note (the sweeper has no key, so it cannot clean up itself).
 */
export function interruptedRecord(
  record: AuditRecord,
  nowIso: string,
): { status: 'completed' | 'failed'; record: AuditRecord } {
  const next: AuditRecord = { ...record };
  next.cleanup = 'failed';
  next.cleanupNote = INTERRUPTED_CLEANUP_NOTE;
  if (next.reportRow && ['queued', 'running'].includes(next.reportRow.status)) {
    next.reportRow = {
      status: 'failed',
      progress: next.reportRow.progress,
      message: 'Not run: the server restarted.',
    };
  }
  if (record.lastRetest?.status === 'running') {
    next.status = 'completed';
    next.progress = 100;
    next.lastRetest = {
      ...record.lastRetest,
      status: 'failed',
      finishedAt: nowIso,
      tablesAdded: [],
      tablesRemoved: [],
      error: {
        code: INTERRUPTED,
        message:
          'The re-test was stopped by a server restart. The earlier findings are unchanged. Run the re-test again.',
      },
    };
    return { status: 'completed', record: next };
  }
  next.status = 'failed';
  next.error = {
    code: INTERRUPTED,
    message: 'The audit was stopped by a server restart. Start a new audit.',
  };
  return { status: 'failed', record: next };
}

/**
 * Runs once at boot, before the server listens. Every row that is still
 * `running` belongs to a process that no longer exists. Each write is guarded
 * (status = running and the same run id), so a row that changed in the
 * meantime is left alone. Returns how many rows were changed.
 */
export async function sweepInterrupted(
  repo: AuditRepository,
  now: () => Date = () => new Date(),
): Promise<number> {
  let changed = 0;
  for (const row of await repo.listRunning()) {
    if (!row.runId) continue;
    const swept = interruptedRecord(row.record, now().toISOString());
    const ok = await repo.finish(
      row.id,
      row.runId,
      swept.status,
      redactForStorage(swept.record, repo.ownSecrets),
    );
    if (ok) changed++;
  }
  return changed;
}
