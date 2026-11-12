export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ModuleStatus = AuditStatus;
export type Verdict = 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FixStatus = 'proposed' | 'approved';
export type RetestStatus = 'not_run' | 'running' | 'passed' | 'failed';
export type CleanupState = 'ok' | 'failed' | null;
export type OperationName = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
export type OperationActor = 'user_b' | 'anon' | 'owner';

export interface Explanation {
  en: string;
  ur: string;
}

export interface OperationEvidence {
  operation: OperationName;
  actor: OperationActor;
  allowed: boolean | null;
  httpStatus: number | null;
  rowsReturned: number | null;
  note?: string;
}

export interface FindingEvidence {
  rowsReturned: number;
  httpStatus: number;
  canaryRowId: string | null;
  reproducer: string | null;
  operations?: OperationEvidence[];
}

export interface FindingFix {
  status: FixStatus;
  description: string;
  sql: string;
}

export interface FindingRetest {
  status: RetestStatus;
  lastRunAt: string | null;
}

export interface Finding {
  id: string;
  module: string;
  table: string;
  operation: OperationName;
  verdict: Verdict;
  severity: Severity;
  title: string;
  explanation: Explanation;
  evidence: FindingEvidence;
  fix: FindingFix | null;
  retest: FindingRetest;
}

export interface AuditSummary {
  leaked: number;
  blocked: number;
  inconclusive: number;
}

export interface AuditModule {
  id: string;
  name: string;
  status: ModuleStatus;
  progress: number;
}

export interface AuditError {
  code: string;
  message: string;
}

export interface AuditTarget {
  label: string;
  projectUrl: string;
}

export interface AuditStatusResponse {
  id: string;
  status: AuditStatus;
  createdAt: string;
  target: AuditTarget;
  summary: AuditSummary;
  modules: AuditModule[];
  cleanup: CleanupState;
  cleanupNote?: string;
  error?: AuditError;
}

export interface FindingsResponse {
  findings: Finding[];
}

export interface StartAuditResponse {
  id: string;
  status: AuditStatus;
}

export interface Certificate {
  auditId: string;
  issuedAt: string;
  result: 'NO_LEAK_FOUND_BY_THESE_CHECKS';
  checksRun: string[];
  disclaimer: string;
  recordHash: string;
}

export interface StartAuditInput {
  label?: string;
  projectUrl: string;
  anonKey: string;
  serviceKey: string;
  confirmTestProject: boolean;
}
