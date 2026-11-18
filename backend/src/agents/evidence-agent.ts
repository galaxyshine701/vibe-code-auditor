import { buildCoverage, buildEvidence } from '../stages/evidence.js';
import { collectResults } from '../stages/inspectors.js';
import { CHECKS, type CheckDefinition } from '../stages/planner-config.js';
import { buildStageInput } from '../stages/stage-input.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';

export const EVIDENCE_AGENT_ID = 'evidence';

/** The same value with `fn` applied to every text in it (a deep copy). */
export function mapTexts<T>(value: T, fn: (text: string) => string): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapTexts(item, fn)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapTexts(item, fn)]),
    ) as T;
  }
  return value;
}

/**
 * Evidence: what the checks found, as evidence items and a coverage. Plain
 * code: the verdict and the proof come from the Prover's findings and from
 * fixed rules; this agent only READS the findings and never changes them.
 * Every text it copies goes through the run's redaction first (the persist
 * boundary does it once more). It still runs after a failure: a Prover that
 * did not finish is a `failedToRun` check, never a pass.
 */
export function createEvidenceAgent(
  definitions: readonly CheckDefinition[] = CHECKS,
): Agent<RunContext> {
  return {
    id: EVIDENCE_AGENT_ID,
    name: 'Evidence',
    critical: false,
    alwaysRun: true,
    run(context, _setProgress, control) {
      const redact = (text: string) => control?.redact(text) ?? text;
      const input = (context.stageInput ??= buildStageInput(
        context,
        control?.failure() ?? null,
      ));
      const results = collectResults(definitions, input);
      // what the Prover found (about tables), then what the website inspectors found
      context.evidence = mapTexts(
        [...buildEvidence(input.findings), ...(context.siteEvidence ?? [])],
        redact,
      );
      context.coverage = mapTexts(buildCoverage(definitions, results), redact);
      return Promise.resolve();
    },
  };
}
