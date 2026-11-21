import type { Severity } from '../prover/types.js';

/** A sentence in both languages, as everywhere else in the API. */
export interface Text {
  en: string;
  ur: string;
}

/**
 * passive = reads what any visitor can read (no login, no writes).
 * keyed   = runs with the keys the user typed in (the Data Access Prover).
 * active  = sends probes to the site; allowed only after ownership is proven.
 */
export type CheckMode = 'passive' | 'keyed' | 'active';

/**
 * completed   = the check ran to the end.
 * partial     = it ran, but part of it could not be read (a size cap, a time
 *               limit): what was not read is named in the reason.
 * skipped     = it did not run (not built yet, ownership not proven, ...).
 * failedToRun = it tried and broke.
 */
export type CheckStatus = 'completed' | 'partial' | 'skipped' | 'failedToRun';

/** What the user sees about one planned check. */
export interface PlannedCheck {
  id: string;
  title: Text;
  mode: CheckMode;
  /** A required check that did not complete keeps the gate at `not_ready`. */
  required: boolean;
}

export interface CheckResult {
  id: string;
  status: CheckStatus;
  /** For partial, skipped and failedToRun: why. */
  reason?: Text;
  /**
   * Set on a COMPLETED check that found nothing to test (for example the
   * Data Access Prover when no table is exposed). The text is the note that
   * goes into the coverage. This is not a failure and not a skip.
   */
  nothingToTest?: Text;
  /** For partial: what was not read (a name and a reason each). */
  notRead?: { name: string; reason: Text }[];
  /**
   * Things that are out of scope on purpose (for example a script of another
   * origin): listed by name in the coverage. This is NOT "partial".
   */
  outOfScope?: { name: string; reason: Text }[];
}

export type Proof = 'PROVEN' | 'UNVERIFIED';

/**
 * What an evidence item is about. A missing `kind` means `table` (the items
 * of the Data Access Prover, which have always been like that).
 */
export type EvidenceKind =
  | 'table'
  | 'site-bundle'
  | 'site-headers'
  /** a secret key in a file of the GitHub repository (Repo Scan) */
  | 'repo-file';

/** What the user gave for this run. A check needs one of them. */
export interface Provided {
  website: boolean;
  supabase: boolean;
  /** A GitHub repository was given. Missing = no (and the repo check is not planned). */
  repo?: boolean;
}

export interface EvidenceItem {
  id: string;
  check: string;
  /** null for an item that is not about a finding of the Prover. */
  findingId: string | null;
  /** null for an item that is not about a table. */
  table: string | null;
  /** What it is about when it is not a table: a script or a header of the site. */
  subject?: string;
  /** For a file of a repository: the 1-based line. Never the text of the line. */
  line?: number;
  kind?: EvidenceKind;
  verdict: 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE';
  /** PROVEN = seen directly by the check. UNVERIFIED = the check could not tell. */
  proof: Proof;
  summary: Text;
}

export interface Coverage {
  /** ids of the checks that completed */
  checked: string[];
  /** ran, but part was not read; `notRead` names each part and why */
  partial: {
    id: string;
    reason: Text;
    notRead: { name: string; reason: Text }[];
  }[];
  skipped: { id: string; reason: Text }[];
  /** named things left out on purpose, with the reason */
  outOfScope: { name: string; reason: Text }[];
  failedToRun: { id: string; reason: Text }[];
  /** completed checks that had nothing to test, with a note (for example zero tables) */
  nothingToTest: { id: string; note: Text }[];
  /** what these checks can not tell, in plain words */
  limits: Text[];
}

export type GateDecision = 'ready_by_these_checks' | 'not_ready';

export interface Gate {
  decision: GateDecision;
  /** Why it is `not_ready`. Always empty when the decision is ready. */
  reasons: Text[];
}

export type OwnershipStatus = 'skipped' | 'proven' | 'not_proven';

export interface Ownership {
  status: OwnershipStatus;
  /** Why ownership was not checked (for `skipped` and `not_proven`). */
  reason?: Text;
}

/**
 * What kind of step a roadmap item is. A held-up table (BLOCKED), a check that
 * is "not implemented yet" and ownership never get an item.
 */
export type RoadmapKind =
  | 'fix-finding'
  | 'fix-site-secret'
  | 'fix-repo-secret'
  | 'improve-header'
  | 'improve-repo'
  | 'confirm'
  | 'cleanup'
  | 'finish-check'
  | 'provide-input'
  | 'retest';

export interface RoadmapItem {
  /** rm_001... in the final order */
  id: string;
  kind: RoadmapKind;
  severity: Severity;
  /** true when the item comes from a check that is required in this run */
  fromRequiredCheck: boolean;
  title: Text;
  why: Text;
  /** 1 to 4 steps */
  steps: Text[];
  /**
   * A fixed text to paste into the AI tool that built the app (English first,
   * Roman Urdu as the second copy). Only on fix-finding, fix-site-secret,
   * fix-repo-secret, improve-header and improve-repo. Never holds a key.
   */
  fixPrompt?: Text;
  refs: { checkId: string; findingIds?: string[]; evidenceIds?: string[] };
}

export interface Roadmap {
  schemaVersion: 1;
  items: RoadmapItem[];
  /** how many items were left out because of the cap */
  truncated: number;
}

/** A check, named for the client report. */
export interface ScopeEntry {
  id: string;
  title: Text;
}

/** A plain summary of one run for a person who does not read the details. */
export interface ClientReport {
  schemaVersion: 1;
  headline: Text;
  decision: GateDecision;
  reasons: Text[];
  scope: {
    checked: ScopeEntry[];
    notProvided: ScopeEntry[];
    /** skipped for a reason other than "not provided" (today: not built yet) */
    notImplemented: ScopeEntry[];
    partial: ScopeEntry[];
    failedToRun: ScopeEntry[];
    outOfScope: { name: string; reason: Text }[];
  };
  findings: {
    /** null when the data access check did not complete */
    tables: { leaked: number; blocked: number; inconclusive: number } | null;
    /** null when no website check completed */
    site: { siteLeaked: number; headersMissing: number } | null;
    /**
     * Only for a run that has a GitHub repository. null when the repo scan
     * did not complete.
     */
    repo?: { leaked: number } | null;
  };
  /** the ids of the first three roadmap items */
  topActions: string[];
  limits: Text[];
  disclaimer: Text;
}

/** Everything the stages decide about one run. Stored with the audit. */
export interface LockC {
  schemaVersion: 2;
  ownership: Ownership;
  plan: PlannedCheck[];
  evidence: EvidenceItem[];
  coverage: Coverage;
  gate: Gate;
  /** Missing on an audit made before the Roadmap agent, and with the flag off. */
  roadmap?: Roadmap;
  clientReport?: ClientReport;
}

export const LOCK_C_SCHEMA_VERSION = 2 as const;
