import { REPO_CHECK_ID } from './planner-config.js';
import type {
  Coverage,
  EvidenceItem,
  Gate,
  PlannedCheck,
  Text,
} from './types.js';

export interface GateInput {
  plan: readonly PlannedCheck[];
  coverage: Coverage;
  evidence: readonly EvidenceItem[];
  cleanup: 'ok' | 'failed' | null;
  /**
   * Checks that were not run because their input was not given. When the
   * decision is `not_ready`, each one is named in the reasons.
   */
  notProvided?: readonly { id: string; title: Text }[];
}

/**
 * Guide stage (the gate). `ready_by_these_checks` needs ALL of these:
 *  1. at least one check completed (an empty coverage is never ready),
 *  2. every REQUIRED check completed (not skipped, not partial, not failed),
 *  3. no leak found, and still there,
 *  4. the temporary test users and rows were removed,
 *  5. at least one table was shown to be blocked, OR the Data Access Prover
 *     completed with no exposed table at all ("zero tables"). That is a state
 *     of its own: it can be ready, and the coverage carries a note that no
 *     table data was tested. This rule is only for a run in which the Data
 *     Access Prover is required: without Supabase details it is optional, and
 *     there is no table to block.
 *  6. at least one REQUIRED check completed (a run in which only an optional
 *     check completed is never ready).
 * Anything else is `not_ready`, and `reasons` says why. The words are always
 * "by these checks": this is never a promise that an app is secure.
 */
export function evaluateGate(input: GateInput): Gate {
  const { plan, coverage, evidence, cleanup, notProvided } = input;
  const reasons: Text[] = [];
  // The Prover is explicitly optional in this plan (no Supabase details).
  const dataAccessOptional = plan.some(
    (c) => c.id === 'data-access-prover' && !c.required,
  );

  if (coverage.checked.length === 0) {
    reasons.push({
      en: 'No check finished, so there is nothing to base a result on.',
      ur: 'Koi check poora nahi hua, isliye nateeje ki koi buniyad nahi.',
    });
  }

  for (const check of plan) {
    if (!check.required || coverage.checked.includes(check.id)) continue;
    if (coverage.failedToRun.some((c) => c.id === check.id)) {
      reasons.push({
        en: `The required check "${check.title.en}" failed to run.`,
        ur: `Zaroori check "${check.title.ur}" chal nahi saka.`,
      });
    } else if (coverage.partial.some((c) => c.id === check.id)) {
      reasons.push({
        en: `The required check "${check.title.en}" was only partly done.`,
        ur: `Zaroori check "${check.title.ur}" sirf adhoora hua.`,
      });
    } else {
      reasons.push({
        en: `The required check "${check.title.en}" was skipped.`,
        ur: `Zaroori check "${check.title.ur}" skip hua.`,
      });
    }
  }

  // The repo scan is optional, so the loop above does not hold it. But a run
  // that was GIVEN a repository must not say "no leak found" as if the code had
  // been read when it was not. Only a run with the repo check in its plan gets
  // this; every other run is unchanged.
  if (
    plan.some((c) => c.id === REPO_CHECK_ID) &&
    !coverage.checked.includes(REPO_CHECK_ID)
  ) {
    reasons.push(
      coverage.partial.some((c) => c.id === REPO_CHECK_ID)
        ? {
            en: 'Repo scan was only partly done: some files of the repository were not read.',
            ur: 'Repo scan sirf adhoora hua: repository ki kuch files parhi nahi gayin.',
          }
        : {
            en: 'Repo scan did not run.',
            ur: 'Repo scan chala nahi.',
          },
    );
  }

  if (evidence.some((e) => e.verdict === 'LEAKED')) {
    reasons.push({
      en: 'A leak was found and is still there. Fix it, then run a re-test.',
      ur: 'Ek leak mila aur abhi maujood hai. Isse theek karein, phir re-test chalayein.',
    });
  }

  if (cleanup === 'failed') {
    reasons.push({
      en: 'The temporary test users could not be removed. Clean them up by hand, then run a re-test.',
      ur: 'Aarzi test users hataye nahi ja sake. Unhein haath se hatayein, phir re-test chalayein.',
    });
  }

  // zero tables: the Prover completed and had nothing to test. Only that check
  // counts; a note on another check does not excuse "nothing was blocked".
  const zeroTables = coverage.nothingToTest.some(
    (n) => n.id === 'data-access-prover' && coverage.checked.includes(n.id),
  );
  if (
    coverage.checked.length > 0 &&
    !dataAccessOptional &&
    !zeroTables &&
    !evidence.some((e) => e.verdict === 'BLOCKED')
  ) {
    reasons.push({
      en: 'No table was shown to be blocked, so there is no result to give.',
      ur: 'Koi table blocked sabit nahi hua, isliye nateeja dene ko kuch nahi.',
    });
  }

  if (
    coverage.checked.length > 0 &&
    !plan.some((c) => c.required && coverage.checked.includes(c.id))
  ) {
    reasons.push({
      en: 'No required check finished, so there is nothing to base a result on.',
      ur: 'Koi zaroori check poora nahi hua, isliye nateeje ki koi buniyad nahi.',
    });
  }

  if (reasons.length === 0) {
    return { decision: 'ready_by_these_checks', reasons: [] };
  }
  // A not_ready gate also says what was never looked at because it was not given.
  for (const check of notProvided ?? []) {
    reasons.push({
      en: `Not checked, because it was not provided: "${check.title.en}".`,
      ur: `Check nahi hua, kyunke diya nahi gaya: "${check.title.ur}".`,
    });
  }
  return { decision: 'not_ready', reasons };
}
