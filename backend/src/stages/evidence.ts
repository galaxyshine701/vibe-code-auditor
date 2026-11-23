import type { Finding } from '../prover/types.js';
import type { CheckDefinition } from './planner-config.js';
import type { CheckResult, Coverage, EvidenceItem, Text } from './types.js';

const NO_RESULT: Text = {
  en: 'This check did not report a result.',
  ur: 'Is check ne koi nateeja nahi diya.',
};

/**
 * Evidence stage, part 1: one item per finding of the Data Access Prover.
 * PROVEN = the check saw it directly (a leak, or a table that held up).
 * UNVERIFIED = the check could not tell (INCONCLUSIVE).
 */
export function buildEvidence(findings: Finding[]): EvidenceItem[] {
  return findings.map((finding) => ({
    id: `ev_${finding.id}`,
    check: 'data-access-prover',
    findingId: finding.id,
    table: finding.table,
    verdict: finding.verdict,
    proof: finding.verdict === 'INCONCLUSIVE' ? 'UNVERIFIED' : 'PROVEN',
    summary: finding.explanation,
  }));
}

/**
 * Evidence stage, part 2: the coverage. Every planned check appears in exactly
 * one list. A check that reported nothing counts as skipped, so a gap can
 * never look like a pass.
 */
export function buildCoverage(
  definitions: readonly CheckDefinition[],
  results: readonly CheckResult[],
): Coverage {
  const coverage: Coverage = {
    checked: [],
    partial: [],
    skipped: [],
    outOfScope: [],
    failedToRun: [],
    nothingToTest: [],
    limits: [],
  };
  const seenLimits = new Set<string>();
  for (const definition of definitions) {
    const result = results.find((r) => r.id === definition.id);
    const reason = result?.reason ?? NO_RESULT;
    switch (result?.status) {
      case 'completed':
        coverage.checked.push(definition.id);
        if (result.nothingToTest) {
          coverage.nothingToTest.push({
            id: definition.id,
            note: result.nothingToTest,
          });
        }
        break;
      case 'partial':
        coverage.partial.push({
          id: definition.id,
          reason,
          notRead: result.notRead ?? [],
        });
        break;
      case 'failedToRun':
        coverage.failedToRun.push({ id: definition.id, reason });
        break;
      default:
        coverage.skipped.push({ id: definition.id, reason });
    }
    // a count is passed on only when the check gave a real one
    if (
      result?.filesRead !== undefined &&
      Number.isInteger(result.filesRead) &&
      result.filesRead >= 0
    ) {
      (coverage.filesRead ??= []).push({
        id: definition.id,
        count: result.filesRead,
      });
    }
    // named things that were left out on purpose (not "partial")
    coverage.outOfScope.push(...(result?.outOfScope ?? []));
    for (const note of result?.limitNotes ?? []) {
      if (!seenLimits.has(note.en)) {
        seenLimits.add(note.en);
        coverage.limits.push(note);
      }
    }
    for (const limit of definition.limits) {
      if (!seenLimits.has(limit.en)) {
        seenLimits.add(limit.en);
        coverage.limits.push(limit);
      }
    }
  }
  return coverage;
}
