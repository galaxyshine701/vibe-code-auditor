import { buildClientReport } from '../stages/client-report.js';
import { evaluateGate } from '../stages/gate.js';
import {
  CHECKS,
  checksFor,
  isProvided,
  type CheckDefinition,
} from '../stages/planner-config.js';
import { planChecks } from '../stages/planner.js';
import { ROADMAP_UNAVAILABLE } from '../stages/roadmap.js';
import { OWNERSHIP_NOT_CHECKED } from '../stages/run-stages.js';
import { buildStageInput } from '../stages/stage-input.js';
import {
  EVIDENCE_UNAVAILABLE,
  unavailableCoverage,
} from '../stages/failsafe.js';
import { LOCK_C_SCHEMA_VERSION } from '../stages/types.js';
import type { Agent } from './agent.js';
import { mapTexts } from './evidence-agent.js';
import type { RunContext } from './run-context.js';

export const GUIDE_AGENT_ID = 'guide';

/**
 * Guide: puts the stage result together and decides the gate. The gate comes
 * ONLY from the plan, the coverage, the evidence and the cleanup state (the
 * rules in gate.ts). It does not look at the rows of the other agents: an
 * agent that was skipped or failed changes the gate only through the coverage
 * it left. The rows are written by the pipeline, not by this agent.
 *
 * It still runs after a failure. If the evidence is missing (the Evidence
 * agent failed or ran out of time) the result is a fixed `not_ready` with its
 * reason, and every check is `failedToRun`: nothing can look ready by
 * accident.
 */
export function createGuideAgent(
  definitions: readonly CheckDefinition[] = CHECKS,
): Agent<RunContext> {
  return {
    id: GUIDE_AGENT_ID,
    name: 'Guide',
    critical: false,
    alwaysRun: true,
    run(context, _setProgress, control) {
      const plan = context.plan ?? planChecks(checksFor(definitions, context.provided));
      const input = (context.stageInput ??= buildStageInput(
        context,
        control?.failure() ?? null,
      ));
      const available =
        context.evidence !== undefined && context.coverage !== undefined;
      const evidence = available ? context.evidence! : [];
      const coverage = available
        ? context.coverage!
        : unavailableCoverage(plan);
      const gate = evaluateGate({
        plan,
        coverage,
        evidence,
        cleanup: input.cleanup,
        notProvided: checksFor(definitions, context.provided)
          .filter((d) => !isProvided(d, context.provided))
          .map((d) => ({ id: d.id, title: d.title })),
      });
      const finalGate = available
        ? gate
        : {
            decision: 'not_ready' as const,
            reasons: [EVIDENCE_UNAVAILABLE, ...gate.reasons],
          };
      const roadmap = context.roadmap ?? ROADMAP_UNAVAILABLE;
      context.lockC = {
        schemaVersion: LOCK_C_SCHEMA_VERSION,
        ownership: context.ownership ?? OWNERSHIP_NOT_CHECKED,
        plan,
        evidence,
        coverage,
        gate: finalGate,
        // Additive: what to do next, and the summary for a client. A Roadmap
        // that did not finish leaves an empty list, and the report says so.
        roadmap,
        clientReport: mapTexts(
          buildClientReport({
            plan,
            evidence,
            coverage,
            gate: finalGate,
            roadmap: context.roadmap ?? null,
          }),
          (text) => control?.redact(text) ?? text,
        ),
      };
      return Promise.resolve();
    },
  };
}
