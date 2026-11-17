import type { AuditRecord } from '../../src/audits/audit-record.js';
import type { AuditRepository } from '../../src/audits/audit-repository.js';

export const sampleRecord = (id: string, createdAt: string): AuditRecord => ({
  id,
  status: 'running',
  createdAt,
  label: 'Contract test',
  projectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  progress: 0,
  findings: [],
  cleanup: null,
  cleanupNote: null,
  error: null,
  completedAt: null,
  nextFindingNumber: 1,
  lastRetest: null,
  proverDone: false,
  reportRow: null,
});

/**
 * The rules every audit store must follow. It runs against the in-memory store
 * always, and against the real Supabase table when TEST_PLATFORM_SUPABASE_URL
 * and TEST_PLATFORM_SUPABASE_SERVICE_KEY are set.
 * `makeRepo` returns a store; `uniqueId` returns an id that no other test used.
 */
export function describeRepositoryContract(
  name: string,
  makeRepo: () => AuditRepository,
  options: { skip?: boolean } = {},
): void {
  const suite = options.skip ? describe.skip : describe;
  suite(`audit store contract: ${name}`, () => {
    let repo: AuditRepository;
    let counter = 0;
    const uniqueId = () =>
      `aud_contract_${Date.now().toString(36)}_${(counter++).toString(36)}`;
    const created = () => new Date().toISOString();
    const insertRunning = async (id: string, runId: string) => {
      await repo.insert({
        id,
        status: 'running',
        createdAt: created(),
        runId,
        record: sampleRecord(id, created()),
      });
    };
    const removeAll = async (ids: string[]) => {
      // leave nothing behind: finish every row, then prune to zero is not
      // possible, so finished rows are simply kept out of the way by unique ids
      for (const id of ids) {
        const row = await repo.get(id);
        if (row?.status === 'running' && row.runId) {
          await repo.finish(id, row.runId, 'failed', row.record);
        }
      }
    };
    const used: string[] = [];
    const fresh = () => {
      const id = uniqueId();
      used.push(id);
      return id;
    };

    beforeEach(() => {
      repo = makeRepo();
    });
    afterEach(async () => {
      await removeAll(used.splice(0));
    });

    it('ping works', async () => {
      await expect(repo.ping()).resolves.toBeUndefined();
    });

    it('stores a row and reads it back with the same record', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const row = await repo.get(id);
      expect(row?.status).toBe('running');
      expect(row?.runId).toBe('run_a');
      expect(row?.record.id).toBe(id);
      expect(row?.record.label).toBe('Contract test');
    });

    it('answers null for an unknown id', async () => {
      expect(await repo.get('aud_does_not_exist')).toBeNull();
    });

    it('a guarded write needs status running AND the same run id', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const record = { ...sampleRecord(id, created()), progress: 40 };
      expect(await repo.writeRunning(id, 'run_other', record)).toBe(false);
      expect((await repo.get(id))?.record.progress).toBe(0);
      expect(await repo.writeRunning(id, 'run_a', record)).toBe(true);
      expect((await repo.get(id))?.record.progress).toBe(40);
    });

    it('finish sets the final status once; a second write changes 0 rows', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const done = {
        ...sampleRecord(id, created()),
        status: 'completed' as const,
      };
      expect(await repo.finish(id, 'run_a', 'completed', done)).toBe(true);
      expect((await repo.get(id))?.status).toBe('completed');
      // a late write from the same run now changes nothing
      expect(await repo.writeRunning(id, 'run_a', done)).toBe(false);
      expect(await repo.finish(id, 'run_a', 'failed', done)).toBe(false);
      expect((await repo.get(id))?.status).toBe('completed');
    });

    it('a retest can begin only on a completed row, with a new run id', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const record = sampleRecord(id, created());
      expect(await repo.beginRetest(id, 'run_b', record)).toBe(false);
      await repo.finish(id, 'run_a', 'completed', record);
      expect(await repo.beginRetest(id, 'run_b', record)).toBe(true);
      const row = await repo.get(id);
      expect(row?.status).toBe('running');
      expect(row?.runId).toBe('run_b');
      // the first run is locked out now
      expect(await repo.writeRunning(id, 'run_a', record)).toBe(false);
      expect(await repo.writeRunning(id, 'run_b', record)).toBe(true);
    });

    it('saveIdle works only when nobody saved in between and no run is going', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const record = sampleRecord(id, created());
      const running = await repo.get(id);
      expect(await repo.saveIdle(id, running!.updatedAt, record)).toBe(false);
      await repo.finish(id, 'run_a', 'completed', record);
      const idle = await repo.get(id);
      expect(await repo.saveIdle(id, 'not-the-time-it-was-read', record)).toBe(
        false,
      );
      expect(await repo.saveIdle(id, idle!.updatedAt, record)).toBe(true);
      // the same stale time is refused the second time
      expect(await repo.saveIdle(id, idle!.updatedAt, record)).toBe(false);
    });

    it('saveIdle takes updated_at exactly as it was read; a value that differs only in the last digit is refused', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const record = sampleRecord(id, created());
      await repo.finish(id, 'run_a', 'completed', record);
      const read = await repo.get(id);
      const stamp = read!.updatedAt;
      // split "2026-11-17T00:00:00.123456+00:00" into head, fraction, tail
      const [head, fraction, tail] = stamp.split(/(?<=\.)(\d+)/);
      expect(fraction).toBeDefined();
      expect(fraction!.length).toBeGreaterThanOrEqual(3);
      const last = Number(fraction!.slice(-1));
      const off = `${head}${fraction!.slice(0, -1)}${(last + 1) % 10}${tail}`;
      expect(off).not.toBe(stamp);
      expect(await repo.saveIdle(id, off, record)).toBe(false);
      // the exact text that was read works (no rounding, no re-formatting)
      expect(await repo.saveIdle(id, stamp, record)).toBe(true);
      // and what is read after the save is a new value that works the same way
      const again = await repo.get(id);
      expect(again!.updatedAt).not.toBe(stamp);
      expect(await repo.saveIdle(id, again!.updatedAt, record)).toBe(true);
    });

    it('prune keeps the newest 50 of 53 rows and never removes a running row', async () => {
      // created_at is in the future of every other test row, so these are the newest
      const base = Date.now() + 10 * 60 * 1000;
      const ids: string[] = [];
      for (let i = 0; i < 53; i++) {
        const id = fresh();
        ids.push(id);
        const createdAt = new Date(base + i).toISOString();
        await repo.insert({
          id,
          status: 'running',
          createdAt,
          runId: `run_${i}`,
          record: sampleRecord(id, createdAt),
        });
        // the oldest (0) stays running; every other row is finished
        if (i > 0) {
          await repo.finish(
            id,
            `run_${i}`,
            'completed',
            sampleRecord(id, createdAt),
          );
        }
      }
      await repo.prune(50);
      expect(await repo.get(ids[0])).not.toBeNull(); // oldest, but running
      expect(await repo.get(ids[1])).toBeNull();
      expect(await repo.get(ids[2])).toBeNull();
      expect(await repo.get(ids[3])).not.toBeNull(); // the 50th newest
      expect(await repo.get(ids[52])).not.toBeNull();
    });

    it('lists the running rows', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const running = await repo.listRunning();
      expect(running.map((row) => row.id)).toContain(id);
      await repo.finish(id, 'run_a', 'failed', sampleRecord(id, created()));
      const after = await repo.listRunning();
      expect(after.map((row) => row.id)).not.toContain(id);
    });
  });
}
