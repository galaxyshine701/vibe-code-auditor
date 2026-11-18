import type { Finding } from '../prover/types.js';
import {
  ACTIVE_NOT_AVAILABLE,
  CHECKS,
  NOT_IMPLEMENTED,
  isProvided,
  notProvidedReason,
  type CheckDefinition,
} from './planner-config.js';
import type { CheckResult, Provided, Text } from './types.js';

export const ZERO_TABLES_NOTE: Text = {
  en: 'No exposed tables were found, so no table data was tested. This says nothing about data the API does not expose.',
  ur: 'Koi exposed table nahi mila, isliye table ke data ka koi test nahi hua. Jo data API expose nahi karti uske bare mein ye kuch nahi kehta.',
};

/** What the inspectors get to know about the run so far. */
export interface StageInput {
  findings: Finding[];
  cleanup: 'ok' | 'failed' | null;
  /** How the Data Access Prover ended. */
  dataAccess:
    | {
        status: 'completed';
        /** the Prover finished and there was no exposed table to test */
        zeroTables?: boolean;
      }
    | { status: 'failedToRun'; message: string }
    /** No Supabase details were given, so the Prover was not run. */
    | { status: 'notProvided' };
  /** What the user gave. Missing = everything (flag off, and audits before this). */
  provided?: Provided;
  /**
   * What the website inspectors reported, by check id. Missing = those
   * inspectors did not run (not built, or flag off): the old "not implemented".
   */
  siteResults?: Record<string, CheckResult>;
}

/** The checks whose result comes from the website inspectors. */
const SITE_CHECKS = new Set(['tls-headers', 'bundle-secrets']);

const SITE_NO_RESULT: Text = {
  en: 'This check was planned but did not report a result.',
  ur: 'Ye check plan hua tha lekin isne koi nateeja nahi diya.',
};

type Inspector = (input: StageInput) => CheckResult;

/**
 * Inspectors stage. Only checks that have code are listed here; a planned
 * check with no entry is reported as `skipped`, with the reason. Each later
 * step adds one entry and removes one skip.
 */
const INSPECTORS: Record<string, Inspector> = {
  // The Data Access Prover already ran (it is the first part of the run).
  'data-access-prover': (input) =>
    input.dataAccess.status === 'notProvided'
      ? {
          id: 'data-access-prover',
          status: 'skipped',
          reason: notProvidedReason({
            needs: 'supabase',
            title: CHECKS.find((c) => c.id === 'data-access-prover')!.title,
          }),
        }
      : input.dataAccess.status === 'completed'
        ? {
            id: 'data-access-prover',
            status: 'completed',
            ...(input.dataAccess.zeroTables
              ? { nothingToTest: ZERO_TABLES_NOTE }
              : {}),
          }
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
    // The input this check needs was not given: skipped, and it says so.
    if (!isProvided(definition, input.provided)) {
      return {
        id: definition.id,
        status: 'skipped' as const,
        reason: notProvidedReason(definition),
      };
    }
    // A website check, when the website inspectors ran: what they reported,
    // and if they reported nothing, a failure (never a pass).
    if (SITE_CHECKS.has(definition.id) && input.siteResults) {
      return (
        input.siteResults[definition.id] ?? {
          id: definition.id,
          status: 'failedToRun' as const,
          reason: SITE_NO_RESULT,
        }
      );
    }
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
