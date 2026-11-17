import { CHECKS, type CheckDefinition } from './planner-config.js';
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
