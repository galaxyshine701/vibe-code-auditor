import { CHECKS, type CheckDefinition } from '../stages/planner-config.js';
import { planRun } from '../stages/planner.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';

export const PLANNER_AGENT_ID = 'planner';

/**
 * Planner: which checks does this run have? The plan comes from the fixed
 * check list (and the limits from BUNDLE_SCAN_LIMITS). Plain code: no network,
 * no model.
 */
export function createPlannerAgent(
  definitions: readonly CheckDefinition[] = CHECKS,
): Agent<RunContext> {
  return {
    id: PLANNER_AGENT_ID,
    name: 'Planner',
    critical: false,
    run(context) {
      const { plan, limits } = planRun(definitions, context.provided);
      context.plan = plan;
      context.limits = limits;
      return Promise.resolve();
    },
  };
}
