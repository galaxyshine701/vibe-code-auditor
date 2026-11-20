import {
  BUNDLE_SCAN_LIMITS,
  CHECKS,
  checksFor,
  isProvided,
  type BundleScanLimits,
  type CheckDefinition,
} from './planner-config.js';
import type { PlannedCheck, Provided } from './types.js';

/**
 * Planner stage: which checks does this run have? Today the answer is the
 * fixed list in planner-config.ts, and every check is planned whether or not
 * its code exists yet (a check without code is shown as `skipped` in the
 * coverage, never left out).
 */
export function planChecks(
  definitions: readonly CheckDefinition[] = CHECKS,
  provided?: Provided,
): PlannedCheck[] {
  return checksFor(definitions, provided).map((definition) => ({
    id: definition.id,
    title: definition.title,
    mode: definition.mode,
    // A check whose input was not given is optional: it cannot hold the gate
    // back, and it is shown as skipped with the reason "not provided".
    required: definition.required && isProvided(definition, provided),
  }));
}

/**
 * The plan of a run and the limits of its checks, from code. The inspectors
 * read their limits from here, so there is one place that says how much a
 * check may read.
 */
export function planRun(
  definitions: readonly CheckDefinition[] = CHECKS,
  provided?: Provided,
): {
  plan: PlannedCheck[];
  limits: { bundle: BundleScanLimits };
} {
  return {
    plan: planChecks(definitions, provided),
    limits: { bundle: BUNDLE_SCAN_LIMITS },
  };
}
