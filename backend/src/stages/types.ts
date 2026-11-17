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

export interface EvidenceItem {
  id: string;
  check: string;
  findingId: string;
  table: string;
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

/** Everything the stages decide about one run. Stored with the audit. */
export interface LockC {
  schemaVersion: 2;
  ownership: Ownership;
  plan: PlannedCheck[];
  evidence: EvidenceItem[];
  coverage: Coverage;
  gate: Gate;
}

export const LOCK_C_SCHEMA_VERSION = 2 as const;
