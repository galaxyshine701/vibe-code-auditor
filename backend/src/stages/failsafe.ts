import { failSafeClientReport } from './client-report.js';
import { CHECKS, type CheckDefinition } from './planner-config.js';
import { planChecks } from './planner.js';
import { ROADMAP_UNAVAILABLE } from './roadmap.js';
import { OWNERSHIP_NOT_CHECKED } from './run-stages.js';
import {
  LOCK_C_SCHEMA_VERSION,
  type Coverage,
  type LockC,
  type PlannedCheck,
  type Text,
} from './types.js';

/**
 * The fixed answers for the day a stage agent is not available (it failed,
 * or ran out of time). They are always `not_ready`: a missing step can never
 * make a run look ready.
 */
export const EVIDENCE_UNAVAILABLE: Text = {
  en: 'The evidence of this run is not available, so there is no result.',
  ur: 'Is run ka saboot maujood nahi, isliye nateeje ki koi buniyad nahi.',
};

export const GATE_UNAVAILABLE: Text = {
  en: 'The result of this run could not be worked out, so there is no result.',
  ur: 'Is run ka nateeja nikala nahi ja saka, isliye nateeje ki koi buniyad nahi.',
};

const STEP_UNAVAILABLE: Text = {
  en: 'No result for this check, because the evidence step was not available.',
  ur: 'Is check ka nateeja nahi, kyunke saboot wala step maujood nahi tha.',
};

/** Every planned check as failedToRun: nothing is "checked", so nothing can pass. */
export function unavailableCoverage(plan: readonly PlannedCheck[]): Coverage {
  return {
    checked: [],
    partial: [],
    skipped: [],
    outOfScope: [],
    failedToRun: plan.map((check) => ({
      id: check.id,
      reason: STEP_UNAVAILABLE,
    })),
    nothingToTest: [],
    limits: [],
  };
}

/** The whole stage result when the Guide itself is not available. */
export function failSafeLockC(
  definitions: readonly CheckDefinition[] = CHECKS,
): LockC {
  const plan = planChecks(definitions);
  return {
    schemaVersion: LOCK_C_SCHEMA_VERSION,
    ownership: OWNERSHIP_NOT_CHECKED,
    plan,
    evidence: [],
    coverage: unavailableCoverage(plan),
    gate: { decision: 'not_ready', reasons: [GATE_UNAVAILABLE] },
    // fixed: no roadmap, and a client report that says there is no result
    roadmap: ROADMAP_UNAVAILABLE,
    clientReport: failSafeClientReport(),
  };
}
