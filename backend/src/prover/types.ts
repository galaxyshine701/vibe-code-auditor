export type Verdict = 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Operation = 'SELECT' | 'UPDATE' | 'DELETE';

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

export interface Finding {
  id: string;
  module: 'data-access-prover';
  table: string;
  operation: Operation;
  verdict: Verdict;
  severity: Severity;
  title: string;
  explanation: { en: string; ur: string };
  evidence: {
    rowsReturned: number | null;
    httpStatus: number | null;
    canaryRowId: string | null;
    reproducer: string | null;
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
