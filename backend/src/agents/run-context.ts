import type { Finding, ProverResult } from '../prover/types.js';
import type { BUNDLE_SCAN_LIMITS } from '../stages/planner-config.js';
import type { StageInput } from '../stages/inspectors.js';
import type {
  Coverage,
  EvidenceItem,
  LockC,
  Ownership,
  PlannedCheck,
} from '../stages/types.js';

/** What the service can tell an agent about a failed run (same words as the record). */
export interface FailureInfo {
  message: string;
  cleanup: 'ok' | 'failed' | null;
}

/**
 * What the agents share during one run. Every agent writes only its own
 * fields. The stage agents (Planner, Ownership, Evidence, Guide) only READ
 * `prover`: they never change a finding.
 */
export interface RunContext {
  prover?: ProverResult;
  /** Planner */
  plan?: PlannedCheck[];
  /** Limits of the checks that are planned (read by the inspectors of step 3). */
  limits?: { bundle: typeof BUNDLE_SCAN_LIMITS };
  /** Ownership */
  ownership?: Ownership;
  /**
   * Given by the service. The findings the stages look at: for a re-test, the
   * list after the merge (the ids the user sees). Missing = the Prover's own.
   */
  stageFindings?: (fresh: Finding[]) => Finding[];
  /**
   * Given by the service. The words and the cleanup state of a failed run, the
   * same ones the audit record gets (a time limit says so, in a fixed sentence).
   */
  describeFailure?: (error: unknown) => FailureInfo;
  /** What the checks are told about the run (made once, by Evidence or Guide). */
  stageInput?: StageInput;
  /** Evidence */
  evidence?: EvidenceItem[];
  coverage?: Coverage;
  /** Guide: the whole stage result, with the gate. */
  lockC?: LockC;
}
