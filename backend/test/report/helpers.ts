import { buildFinding } from '../../src/prover/findings.js';
import type { Finding, OperationResult } from '../../src/prover/types.js';
import type { LlmClient, LlmRequest } from '../../src/report/llm-client.js';

// Made-up values that are easy to search for. They are not real.
export const CANARY_ID = 'CANARY-ROW-ID-123';
export const OWNER_VALUE = 'OWNER-VALUE-456';
export const DB_NOTE = 'NOTE-WITH-DB-ERROR-789';

const ops = (allowed: boolean): OperationResult[] => [
  {
    operation: 'SELECT',
    actor: 'user_b',
    allowed,
    httpStatus: 200,
    rowsReturned: allowed ? 1 : 0,
  },
  {
    operation: 'SELECT',
    actor: 'owner',
    allowed: true,
    httpStatus: 200,
    rowsReturned: 1,
    note: DB_NOTE,
  },
];

export const leakedFinding = (table = 'bookings'): Finding =>
  buildFinding('fnd_001', {
    table,
    ownerColumn: 'user_id',
    verdict: 'LEAKED',
    operation: 'SELECT',
    httpStatus: 200,
    rowsReturned: 1,
    canaryRowId: CANARY_ID,
    ownerValue: OWNER_VALUE,
    culprit: 'user',
    operations: ops(true),
  });

export const blockedFinding = (table = 'profiles'): Finding =>
  buildFinding('fnd_002', {
    table,
    ownerColumn: 'id',
    verdict: 'BLOCKED',
    operation: 'SELECT',
    httpStatus: 200,
    rowsReturned: 0,
    canaryRowId: CANARY_ID,
    operations: ops(false),
  });

export const inconclusiveFinding = (table = 'hotels'): Finding =>
  buildFinding('fnd_003', {
    table,
    ownerColumn: null,
    verdict: 'INCONCLUSIVE',
    operation: 'SELECT',
    httpStatus: 200,
    rowsReturned: 12,
    canaryRowId: null,
    reason: 'no-owner-column',
    operations: [
      {
        operation: 'SELECT',
        actor: 'anon',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 12,
      },
    ],
  });

/** A good answer for each verdict. */
export const goodAnswer = (
  verdict: 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE',
  overrides: Record<string, unknown> = {},
): string => {
  const base = {
    LEAKED: {
      title: 'Other users can read private rows',
      explanationEn:
        'A second test user could read a row that belongs to another user. The table does not limit rows to their owner.',
      explanationUr:
        'Doosre test user ne kisi aur user ki row parh li. Is table me rows sirf maalik tak mehdood nahi hain.',
      fixDescription:
        'Turn on row-level security and allow each user to reach only their own rows.',
    },
    BLOCKED: {
      title: 'The table kept its rows private',
      explanationEn:
        'The second test user and the visitor received no rows. No leak found by these checks.',
      explanationUr:
        'Doosre test user aur visitor ko koi row nahi mili. In checks se koi leak nahi mila.',
      fixDescription: '',
    },
    INCONCLUSIVE: {
      title: 'Public table: please confirm it is intended',
      explanationEn:
        'Anyone can read this table, and no owner column exists. Please confirm that it holds public data.',
      explanationUr:
        'Is table ko har koi parh sakta hai aur isme owner column nahi. Barae meharbani confirm karein ke ye public data hai.',
      fixDescription: '',
    },
  }[verdict];
  return JSON.stringify({ ...base, ...overrides });
};

/** A fake AI provider. The handler decides what it answers. */
export class FakeLlm implements LlmClient {
  calls = 0;
  requests: LlmRequest[] = [];
  constructor(
    private readonly handler: (request: LlmRequest) => string | Promise<string>,
    public readonly model = 'fake-model',
  ) {}
  async generate(request: LlmRequest): Promise<string> {
    this.calls += 1;
    this.requests.push(request);
    return this.handler(request);
  }
}
