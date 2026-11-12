import type {
  Finding,
  Operation,
  OperationResult,
  Severity,
  Verdict,
} from '../prover/types.js';

/** Everything the AI is allowed to see about one finding. */
export interface ReportInput {
  table: string;
  verdict: Verdict;
  severity: Severity;
  /** true when the Prover produced a fix (the AI only words its description). */
  hasFix: boolean;
  operations: {
    operation: Operation;
    actor: OperationResult['actor'];
    allowed: boolean | null;
    httpStatus: number | null;
    rowsReturned: number | null;
  }[];
}

/**
 * Builds the AI input from a finding by picking fields ONE BY ONE, so a field
 * added to Finding later cannot reach the AI by accident.
 *
 * Left out on purpose: keys, access code, canaryRowId, the reproducer, the fix
 * SQL, the project address, the free-text `note` of an operation (it can quote
 * a database error) and any row data.
 */
export function buildReportInput(finding: Finding): ReportInput {
  return {
    table: finding.table,
    verdict: finding.verdict,
    severity: finding.severity,
    hasFix: finding.fix !== null,
    operations: finding.evidence.operations.map((o) => ({
      operation: o.operation,
      actor: o.actor,
      allowed: o.allowed,
      httpStatus: o.httpStatus,
      rowsReturned: o.rowsReturned,
    })),
  };
}
