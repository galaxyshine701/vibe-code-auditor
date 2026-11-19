import { buildCoverage, buildEvidence } from './evidence.js';
import { evaluateGate } from './gate.js';
import { collectResults, type StageInput } from './inspectors.js';
import { CHECKS, type CheckDefinition } from './planner-config.js';
import { planChecks } from './planner.js';
import { LOCK_C_SCHEMA_VERSION, type LockC, type Ownership } from './types.js';

/**
 * Ownership of the site is not checked yet. The field is part of the contract
 * from the start, so the frontend can show the reason today.
 */
export const OWNERSHIP_NOT_CHECKED: Ownership = {
  status: 'skipped',
  reason: {
    en: 'Ownership of the site is not checked yet.',
    ur: 'Site ki malkiyat abhi check nahi hoti.',
  },
};

/**
 * The stages after the Data Access Prover: Planner, Inspectors, Evidence and
 * the gate. Pure code, no network and no model. (Roadmap and the client report
 * come in a later step.)
 */
export function runStages(
  input: StageInput,
  definitions: readonly CheckDefinition[] = CHECKS,
): LockC {
  const plan = planChecks(definitions);
  const results = collectResults(definitions, input);
  const evidence = buildEvidence(input.findings);
  const coverage = buildCoverage(definitions, results);
  const gate = evaluateGate({
    plan,
    coverage,
    evidence,
    cleanup: input.cleanup,
  });
  return {
    schemaVersion: LOCK_C_SCHEMA_VERSION,
    ownership: OWNERSHIP_NOT_CHECKED,
    plan,
    evidence,
    coverage,
    gate,
  };
}
