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
 *     table data was tested.
 * Anything else is `not_ready`, and `reasons` says why. The words are always
 * "by these checks": this is never a promise that an app is secure.
 */
export function evaluateGate(input: GateInput): Gate {
  const { plan, coverage, evidence, cleanup } = input;
  const reasons: Text[] = [];

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
    !zeroTables &&
    !evidence.some((e) => e.verdict === 'BLOCKED')
  ) {
    reasons.push({
      en: 'No table was shown to be blocked, so there is no result to give.',
      ur: 'Koi table blocked sabit nahi hua, isliye nateeja dene ko kuch nahi.',
    });
  }

  return reasons.length === 0
    ? { decision: 'ready_by_these_checks', reasons: [] }
    : { decision: 'not_ready', reasons };
}
