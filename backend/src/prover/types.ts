export type Verdict = 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Operation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
/** The operations an attacker (user B or anonymous) tries on the canary. */
export type AttackOperation = Exclude<Operation, 'INSERT'>;

export interface ProverConfig {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  format: string;
  required: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  referencesUsers: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

/** What one actor could do to the canary with one operation. */
export interface OperationResult {
  operation: Operation;
  /** owner = user A, the positive control: the rightful owner should be able to use the row */
  actor: 'user_b' | 'anon' | 'owner';
  /** true = it worked (read / changed / deleted the canary), false = blocked, null = not tested */
  allowed: boolean | null;
  httpStatus: number | null;
  rowsReturned: number | null;
  note?: string;
}

export interface Finding {
  id: string;
  module: 'data-access-prover';
  table: string;
  operation: AttackOperation;
  verdict: Verdict;
  severity: Severity;
  title: string;
  explanation: { en: string; ur: string };
  evidence: {
    rowsReturned: number | null;
    httpStatus: number | null;
    canaryRowId: string | null;
    reproducer: string | null;
    operations: OperationResult[];
  };
  fix: { status: 'proposed'; description: string; sql: string } | null;
  retest: { status: 'not_run'; lastRunAt: null };
}

export interface ProverResult {
  findings: Finding[];
  cleanup: 'ok' | 'failed';
}

export class ProverError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public cleanup?: 'ok' | 'failed',
  ) {
    super(message);
  }
}
