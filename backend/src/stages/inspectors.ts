import type { Finding } from '../prover/types.js';
import {
  ACTIVE_NOT_AVAILABLE,
  NOT_IMPLEMENTED,
  type CheckDefinition,
} from './planner-config.js';
import type { CheckResult } from './types.js';

/** What the inspectors get to know about the run so far. */
export interface StageInput {
  findings: Finding[];
  cleanup: 'ok' | 'failed' | null;
  /** How the Data Access Prover ended. */
  dataAccess:
    { status: 'completed' } | { status: 'failedToRun'; message: string };
}

type Inspector = (input: StageInput) => CheckResult;

/**
 * Inspectors stage. Only checks that have code are listed here; a planned
 * check with no entry is reported as `skipped`, with the reason. Each later
 * step adds one entry and removes one skip.
 */
const INSPECTORS: Record<string, Inspector> = {
  // The Data Access Prover already ran (it is the first part of the run).
  'data-access-prover': (input) =>
    input.dataAccess.status === 'completed'
      ? { id: 'data-access-prover', status: 'completed' }
      : {
          id: 'data-access-prover',
          status: 'failedToRun',
          reason: {
            en: input.dataAccess.message,
            ur: 'Ye check poora nahi ho saka.',
          },
        },
};

/** One result per planned check, in plan order. Never fewer, never more. */
export function collectResults(
  definitions: readonly CheckDefinition[],
  input: StageInput,
): CheckResult[] {
  return definitions.map((definition) => {
    const inspector = INSPECTORS[definition.id];
    if (inspector) return inspector(input);
    return {
      id: definition.id,
      status: 'skipped' as const,
      reason:
        definition.mode === 'active' ? ACTIVE_NOT_AVAILABLE : NOT_IMPLEMENTED,
    };
  });
}
