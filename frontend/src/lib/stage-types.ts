// The shapes of the agent pipeline (docs/frontend-brief.md Part 3, R71 to R88).
// They exist only when the backend runs with LOCK_C_AGENTS on. Every field is
// treated as possibly missing: the UI never needs the flag to be on (R71), and a
// field or value it does not know is shown as plain text or ignored (R72).
import type { Severity, Verdict } from './types';

/** A text in both languages. A missing "ur" falls back to English (R82). */
export interface Text {
  en: string;
  ur?: string;
}

export type GateDecision = 'ready_by_these_checks' | 'not_ready';

export interface Gate {
  decision: GateDecision | string;
  reasons?: Text[];
}

export interface PlanCheck {
  id: string;
  /** Never shown: the labels are written by the UI from the id (R87). */
  title?: Text;
  mode?: string;
  required?: boolean;
}

export interface Ownership {
  status?: string;
  reason?: Text;
}

// ---- GET /audits/:id/evidence ----

export type EvidenceKind =
  | 'table'
  | 'site-bundle'
  | 'site-headers'
  | 'repo-file'
  | 'repo-test-key'
  | 'repo-env-file'
  | 'repo-env-name'
  | 'repo-migration'
  | string;

export interface EvidenceItem {
  id: string;
  check: string;
  /** null for a site item. */
  findingId?: string | null;
  /** null for a site item. */
  table?: string | null;
  verdict: Verdict | string;
  proof?: 'PROVEN' | 'UNVERIFIED' | string;
  summary?: Text;
  /** Missing means "table" (R79). */
  kind?: EvidenceKind;
  subject?: string;
  /** For a repository file: the 1-based line. Never the text of the line. */
  line?: number;
}

export interface CoveragePartial {
  id: string;
  reason?: Text;
  notRead?: { name: string; reason?: Text }[];
}

export interface CoverageSkipped {
  id: string;
  reason?: Text;
}

export interface CoverageOutOfScope {
  name: string;
  reason?: Text;
}

export interface Coverage {
  checked?: string[];
  partial?: CoveragePartial[];
  skipped?: CoverageSkipped[];
  failedToRun?: CoverageSkipped[];
  outOfScope?: CoverageOutOfScope[];
  /** Reserved, always [] today: nothing is shown for it. */
  nothingToTest?: unknown[];
  limits?: Text[];
  /** How many files a check read, by check id. Missing = no check gave a count. */
  filesRead?: { id: string; count: number }[];
}

export interface EvidenceResponse {
  schemaVersion?: number;
  items?: EvidenceItem[];
  coverage?: Coverage;
}

// ---- GET /audits/:id/roadmap ----

export interface RoadmapItem {
  id: string;
  kind: string;
  severity: Severity | string;
  fromRequiredCheck?: boolean;
  title?: Text;
  why?: Text;
  steps?: Text[];
  /** A fixed text to paste into the AI tool that built the app (never holds a key). */
  fixPrompt?: Text;
  refs?: {
    checkId?: string;
    findingIds?: string[];
    evidenceIds?: string[];
  };
}

export interface RoadmapResponse {
  schemaVersion?: number;
  items?: RoadmapItem[];
  /** Items left out because a roadmap has at most 100. */
  truncated?: number;
}

// ---- GET /audits/:id/client-report ----

export interface ScopeCheck {
  id: string;
  /** Never shown (R87). */
  title?: string;
}

export interface ClientReportScope {
  checked?: ScopeCheck[];
  notProvided?: ScopeCheck[];
  notImplemented?: ScopeCheck[];
  partial?: ScopeCheck[];
  failedToRun?: ScopeCheck[];
  outOfScope?: CoverageOutOfScope[];
}

export interface ClientReport {
  schemaVersion?: number;
  headline?: Text;
  decision?: GateDecision | string;
  reasons?: Text[];
  scope?: ClientReportScope;
  findings?: {
    /** null: the table check did not complete. Shown as "not checked", never 0. */
    tables?: { leaked: number; blocked: number; inconclusive: number } | null;
    /** null: no site check ran. */
    site?: { siteLeaked: number; headersMissing: number } | null;
    /** Only for a run with a repository. null: the repo scan did not finish. */
    repo?: { leaked: number } | null;
  };
  /** Ids of the first three roadmap items. */
  topActions?: string[];
  limits?: Text[];
  disclaimer?: Text;
}

/** What the Report screen reads after a finished run. null = "this audit has none" (404). */
export interface StageBundle {
  evidence: EvidenceResponse | null;
  roadmap: RoadmapResponse | null;
  clientReport: ClientReport | null;
}
