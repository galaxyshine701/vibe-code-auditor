import type { RunContext } from '../agents/run-context.js';
import type { StageInput } from './inspectors.js';

const DID_NOT_FINISH = 'The data access check did not finish.';

/**
 * What the checks are told about the run, from what the Prover left in the
 * context. A finished Prover: its findings (after the merge, for a re-test).
 * A Prover that did not finish: no findings, and `failure` (the error the
 * pipeline kept) described by the service, in the same words the audit gets.
 * No network, no model.
 */
export function buildStageInput(
  context: RunContext,
  failure: unknown,
): StageInput {
  const prover = context.prover;
  const given = {
    ...(context.provided ? { provided: context.provided } : {}),
    ...(context.siteResults ? { siteResults: context.siteResults } : {}),
  };
  if (prover) {
    const findings = context.stageFindings
      ? context.stageFindings(prover.findings)
      : prover.findings;
    return {
      findings,
      cleanup: prover.cleanup,
      dataAccess: { status: 'completed', zeroTables: findings.length === 0 },
      ...given,
    };
  }
  // No Supabase details were given: the Prover was not run, and that is not a failure.
  if (context.provided && !context.provided.supabase) {
    return {
      findings: [],
      cleanup: null,
      dataAccess: { status: 'notProvided' },
      ...given,
    };
  }
  const info = context.describeFailure?.(
    failure ?? new Error(DID_NOT_FINISH),
  ) ?? { message: DID_NOT_FINISH, cleanup: null };
  return {
    findings: [],
    cleanup: info.cleanup,
    dataAccess: { status: 'failedToRun', message: info.message },
    ...given,
  };
}
