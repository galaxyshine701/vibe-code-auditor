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
/** Runs `work` for every item, `size` at a time, and waits for ALL of them. */
async function inBatches<T>(
  items: T[],
  work: (item: T, index: number) => Promise<void>,
  size = 10,
): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(
      items.slice(start, start + size).map((item, i) => work(item, start + i)),
    );
  }
}

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
      await inBatches(ids, async (id) => {
        const row = await repo.get(id);
        if (row?.status === 'running' && row.runId) {
          await repo.finish(id, row.runId, 'failed', row.record);
        }
      });
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
    }, 60_000);

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

    it('every row has a version text, and every kind of write changes it', async () => {
      const id = fresh();
      const record = sampleRecord(id, created());
      await insertRunning(id, 'run_a');
      const seen = [(await repo.get(id))!.version];
      expect(typeof seen[0]).toBe('string');
      expect(seen[0].length).toBeGreaterThan(0);

      await repo.writeRunning(id, 'run_a', record);
      seen.push((await repo.get(id))!.version);
      await repo.finish(id, 'run_a', 'completed', record);
      seen.push((await repo.get(id))!.version);
      await repo.saveIdle(id, seen[2], record);
      seen.push((await repo.get(id))!.version);
      await repo.beginRetest(id, 'run_b', record);
      seen.push((await repo.get(id))!.version);

      // five writes, five different tokens
      expect(new Set(seen).size).toBe(5);
    });

    it('a refused write does not change the version', async () => {
      const id = fresh();
      const record = sampleRecord(id, created());
      await insertRunning(id, 'run_a');
      const before = (await repo.get(id))!.version;
      expect(await repo.writeRunning(id, 'run_other', record)).toBe(false);
      expect((await repo.get(id))!.version).toBe(before);
    });

    it('saveIdle works only with the version that was read, and only on a finished row', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const record = sampleRecord(id, created());
      const running = await repo.get(id);
      // a run is going: refused, even with the right version
      expect(await repo.saveIdle(id, running!.version, record)).toBe(false);
      await repo.finish(id, 'run_a', 'completed', record);
      const idle = await repo.get(id);
      expect(
        await repo.saveIdle(id, 'not-the-version-it-was-read', record),
      ).toBe(false);
      expect(await repo.saveIdle(id, idle!.version, record)).toBe(true);
      // the same (now old) version is refused the second time
      expect(await repo.saveIdle(id, idle!.version, record)).toBe(false);
      // the version that is read after the save works the same way
      const again = await repo.get(id);
      expect(again!.version).not.toBe(idle!.version);
      expect(await repo.saveIdle(id, again!.version, record)).toBe(true);
    });

    it('saveIdle also works on a failed row, but not on a queued one', async () => {
      const failed = fresh();
      await insertRunning(failed, 'run_a');
      const record = sampleRecord(failed, created());
      await repo.finish(failed, 'run_a', 'failed', record);
      const row = await repo.get(failed);
      expect(await repo.saveIdle(failed, row!.version, record)).toBe(true);

      const queued = fresh();
      await repo.insert({
        id: queued,
        status: 'queued',
        createdAt: created(),
        runId: 'run_q',
        record: sampleRecord(queued, created()),
      });
      const waiting = await repo.get(queued);
      expect(
        await repo.saveIdle(
          queued,
          waiting!.version,
          sampleRecord(queued, created()),
        ),
      ).toBe(false);
    });

    it('a run that starts and ends in between makes saveIdle refuse (the row looks idle again, but it is not the same)', async () => {
      const id = fresh();
      await insertRunning(id, 'run_a');
      const record = sampleRecord(id, created());
      await repo.finish(id, 'run_a', 'completed', record);
      const read = await repo.get(id); // the caller reads here ...

      // ... and meanwhile a whole re-test starts and finishes
      expect(await repo.beginRetest(id, 'run_b', record)).toBe(true);
      expect(await repo.finish(id, 'run_b', 'completed', record)).toBe(true);
      expect((await repo.get(id))!.status).toBe('completed');

      expect(await repo.saveIdle(id, read!.version, record)).toBe(false);
    });

    it('prune keeps the newest 50 of 53 rows and never removes a running row', async () => {
      // created_at is in the future of every other test row, so these are the newest
      const base = Date.now() + 10 * 60 * 1000;
      const ids = Array.from({ length: 53 }, () => fresh());
      const createdAt = (i: number) => new Date(base + i).toISOString();
      // Parallel batches (a real network is slow), and every await is finished
      // before the test goes on, so nothing is still being written afterwards.
      await inBatches(ids, async (id, i) => {
        await repo.insert({
          id,
          status: 'running',
          createdAt: createdAt(i),
          runId: `run_${i}`,
          record: sampleRecord(id, createdAt(i)),
        });
      });
      // the oldest (0) stays running; every other row is finished
      await inBatches(ids.slice(1), async (id, j) => {
        const i = j + 1;
        await repo.finish(
          id,
          `run_${i}`,
          'completed',
          sampleRecord(id, createdAt(i)),
        );
      });
      await repo.prune(50);
      expect(await repo.get(ids[0])).not.toBeNull(); // oldest, but running
      expect(await repo.get(ids[1])).toBeNull();
      expect(await repo.get(ids[2])).toBeNull();
      expect(await repo.get(ids[3])).not.toBeNull(); // the 50th newest
      expect(await repo.get(ids[52])).not.toBeNull();
    }, 60_000);

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
