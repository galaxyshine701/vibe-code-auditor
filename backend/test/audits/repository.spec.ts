import { InMemoryAuditRepository } from './in-memory-audit-repository.js';
import {
  describeRepositoryContract,
  sampleRecord,
} from './repository-contract.js';

describeRepositoryContract('in memory', () => new InMemoryAuditRepository());

describe('in-memory store: prune', () => {
  const at = (n: number) =>
    new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();

  it('keeps the newest rows and never removes a running one', async () => {
    const repo = new InMemoryAuditRepository();
    for (let n = 0; n < 6; n++) {
      await repo.insert({
        id: `aud_${n}`,
        status: 'running',
        createdAt: at(n),
        runId: `run_${n}`,
        record: sampleRecord(`aud_${n}`, at(n)),
      });
      // aud_0 stays running (the oldest); the others finish
      if (n > 0) {
        await repo.finish(
          `aud_${n}`,
          `run_${n}`,
          'completed',
          sampleRecord(`aud_${n}`, at(n)),
        );
      }
    }
    await repo.prune(3);
    expect([...repo.rows.keys()].sort()).toEqual([
      'aud_0', // oldest, but running: kept
      'aud_3',
      'aud_4',
      'aud_5',
    ]);
  });
});
