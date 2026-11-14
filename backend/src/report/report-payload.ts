import type { Finding } from '../prover/types.js';

/**
 * What the AI sees about one finding. Built field by field (an allowlist), so a
 * new field on Finding is never sent by accident. Not sent: keys, the project
 * address, the canary row id, the reproducer, user ids, the fix SQL.
 */
export interface PayloadFinding {
  id: string;
  table: string;
  verdict: Finding['verdict'];
  severity: Finding['severity'];
  hasFix: boolean;
  operations: {
    operation: string;
    actor: string;
    allowed: boolean | null;
    httpStatus: number | null;
    rowsReturned: number | null;
    note?: string;
  }[];
}

export function buildPayload(findings: Finding[]): PayloadFinding[] {
  return findings.map((f) => ({
    id: f.id,
    table: f.table,
    verdict: f.verdict,
    severity: f.severity,
    hasFix: f.fix !== null,
    operations: f.evidence.operations.map((o) => ({
      operation: o.operation,
      actor: o.actor,
      allowed: o.allowed,
      httpStatus: o.httpStatus,
      rowsReturned: o.rowsReturned,
      ...(o.note ? { note: o.note } : {}),
    })),
  }));
}
