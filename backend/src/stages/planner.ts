import {
  BUNDLE_SCAN_LIMITS,
  CHECKS,
  type CheckDefinition,
} from './planner-config.js';
import type { PlannedCheck } from './types.js';

/**
 * Planner stage: which checks does this run have? Today the answer is the
 * fixed list in planner-config.ts, and every check is planned whether or not
 * its code exists yet (a check without code is shown as `skipped` in the
 * coverage, never left out).
 */
export function planChecks(
  definitions: readonly CheckDefinition[] = CHECKS,
): PlannedCheck[] {
  return definitions.map(({ id, title, mode, required }) => ({
    id,
    title,
    mode,
    required,
  }));
}

/**
 * The plan of a run and the limits of its checks, from code. The inspectors
 * read their limits from here, so there is one place that says how much a
 * check may read.
 */
export function planRun(definitions: readonly CheckDefinition[] = CHECKS): {
  plan: PlannedCheck[];
  limits: { bundle: typeof BUNDLE_SCAN_LIMITS };
} {
  return {
    plan: planChecks(definitions),
    limits: { bundle: BUNDLE_SCAN_LIMITS },
  };
}
