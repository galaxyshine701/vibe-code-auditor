import { OWNERSHIP_NOT_CHECKED } from '../stages/run-stages.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';

export const OWNERSHIP_AGENT_ID = 'ownership';

/**
 * Ownership: today the contract says "skipped", with a reason in both
 * languages. The real challenge comes later. The row of this agent is
 * "skipped" too, so the screen shows the same reason.
 */
export function createOwnershipAgent(): Agent<RunContext> {
  return {
    id: OWNERSHIP_AGENT_ID,
    name: 'Ownership',
    critical: false,
    run(context) {
      context.ownership = OWNERSHIP_NOT_CHECKED;
      return Promise.resolve({
        skipped: OWNERSHIP_NOT_CHECKED.reason ?? {
          en: 'Ownership of the site is not checked yet.',
          ur: 'Site ki malkiyat abhi check nahi hoti.',
        },
      });
    },
  };
}
