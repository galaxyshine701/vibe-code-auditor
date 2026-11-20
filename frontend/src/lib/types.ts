import type { Gate, Ownership, PlanCheck, Text } from './stage-types';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
// A row of the progress screen can also be "skipped" (R75). The audit itself
// never is (R10). A status the UI does not know is shown as plain text (R72).
export type ModuleStatus = AuditStatus | 'skipped';
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
  rowsReturned: number | null;
  httpStatus: number | null;
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
  /** Verdict of the same table in the run before. Missing is treated as null (R46). */
  previousVerdict?: Verdict | null;
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
  /** Who wrote explanation.en. Missing means the template text (R62). */
  explanationSource?: 'template' | 'ai';
  evidence: FindingEvidence;
  fix: FindingFix | null;
  retest: FindingRetest;
}

export interface AuditSummary {
  /** Counts tables only. Never the headline alone (R73). */
  leaked: number;
  blocked: number;
  inconclusive: number;
  /** Secret keys found in the scripts of the site. Missing means 0 (R73). */
  siteLeaked?: number;
  /** Secret keys found in the files of the GitHub repository. Missing means 0. */
  repoLeaked?: number;
}

export interface AuditModule {
  id: string;
  name: string;
  status: ModuleStatus;
  progress: number;
  /** One plain sentence, only on a failed row (R62). */
  message?: string;
  /** Only on a skipped row, in both languages (R75). */
  reason?: Text;
}

export interface AuditError {
  code: string;
  message: string;
}

export interface AuditTarget {
  label: string;
  /** Missing for an audit of a website only (R74). */
  projectUrl?: string;
  /** Missing for an audit of Supabase only. */
  websiteUrl?: string;
  /** The public GitHub repository that was read. Missing when none was given. */
  repoUrl?: string;
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
  /** null until a Re-test has been started. Missing is treated as null (R46). */
  lastRetest?: LastRetest | null;
  /** Missing means 1: no stage fields, show the old screens only (R72). */
  schemaVersion?: number;
  plan?: PlanCheck[];
  gate?: Gate;
  ownership?: Ownership;
}

export interface LastRetest {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  tablesAdded: string[];
  tablesRemoved: string[];
  error: AuditError | null;
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
  summary?: { blocked: number; inconclusive: number } | null;
  disclaimer: string;
  recordHash: string;
}

export interface RetestInput {
  anonKey: string;
  serviceKey: string;
  confirmTestProject: true;
}

/**
 * The body of POST /audits (R76). Three optional groups, at least one complete:
 * the website (websiteUrl + confirmSiteAccess), the Supabase project
 * (projectUrl + anonKey + serviceKey + confirmTestProject) and a public GitHub
 * repository (repoUrl + confirmRepoAccess).
 */
export interface StartAuditInput {
  label?: string;
  websiteUrl?: string;
  confirmSiteAccess?: boolean;
  projectUrl?: string;
  anonKey?: string;
  serviceKey?: string;
  confirmTestProject?: boolean;
  /** The public GitHub repository (Repo Scan), with its box. */
  repoUrl?: string;
  confirmRepoAccess?: boolean;
}
