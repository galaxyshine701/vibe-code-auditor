import { describe, expect, it } from 'vitest';
import {
  recordHash,
  type CertificateSubject,
} from '../../src/audits/certificate.js';
import type { Finding } from '../../src/prover/types.js';

const stub = (over: Partial<Finding> = {}): Finding =>
  ({
    id: 'fnd_001',
    module: 'data-access-prover',
    table: 'bookings',
    operation: 'SELECT',
    verdict: 'LEAKED',
    severity: 'critical',
    title: 'Any logged-in user can read bookings',
    explanation: { en: 'template text', ur: 'urdu text' },
    evidence: {
      rowsReturned: 1,
      httpStatus: 200,
      canaryRowId: 'c1',
      reproducer: 'curl x',
      operations: [],
    },
    fix: { status: 'proposed', description: 'd', sql: 'alter table a;' },
    retest: { status: 'not_run', lastRunAt: null },
    ...over,
  }) as Finding;

const subject = (finding: Finding): CertificateSubject => ({
  id: 'aud_1',
  label: 'L',
  projectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  createdAt: '2026-11-12T10:00:00.000Z',
  status: 'completed',
  findings: [finding],
  cleanup: 'ok',
  completedAt: '2026-11-12T10:01:00.000Z',
  lastRetest: null,
});

describe('recordHash and the explanation', () => {
  const base = recordHash(subject(stub()));

  it('is the same when only the explanation text differs', () => {
    expect(
      recordHash(
        subject(
          stub({ explanation: { en: 'AI wrote this', ur: 'urdu text' } }),
        ),
      ),
    ).toBe(base);
    expect(
      recordHash(
        subject(stub({ explanation: { en: 'template text', ur: 'other' } })),
      ),
    ).toBe(base);
  });

  it('is the same when only explanationSource differs', () => {
    expect(recordHash(subject(stub({ explanationSource: 'ai' })))).toBe(base);
    expect(recordHash(subject(stub({ explanationSource: 'template' })))).toBe(
      base,
    );
  });

  it('changes when the verdict changes', () => {
    expect(
      recordHash(subject(stub({ verdict: 'BLOCKED', severity: 'info' }))),
    ).not.toBe(base);
    expect(recordHash(subject(stub({ verdict: 'INCONCLUSIVE' })))).not.toBe(
      base,
    );
  });

  it('changes when the fix SQL changes', () => {
    expect(
      recordHash(
        subject(
          stub({ fix: { status: 'proposed', description: 'd', sql: 'drop;' } }),
        ),
      ),
    ).not.toBe(base);
  });

  it('changes when the severity, the title or the evidence changes', () => {
    expect(recordHash(subject(stub({ severity: 'low' })))).not.toBe(base);
    expect(recordHash(subject(stub({ title: 'Other title' })))).not.toBe(base);
    expect(
      recordHash(
        subject(
          stub({
            evidence: {
              rowsReturned: 2,
              httpStatus: 200,
              canaryRowId: 'c1',
              reproducer: 'curl x',
              operations: [],
            },
          }),
        ),
      ),
    ).not.toBe(base);
  });
});
