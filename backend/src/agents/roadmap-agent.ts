import { buildRoadmap } from '../stages/roadmap.js';
import { buildStageInput } from '../stages/stage-input.js';
import type { Text } from '../stages/types.js';
import type { Agent } from './agent.js';
import { mapTexts } from './evidence-agent.js';
import type { RunContext } from './run-context.js';

export const ROADMAP_AGENT_ID = 'roadmap';

const NO_EVIDENCE: Text = {
  en: 'Not run: the evidence of this run is not available.',
  ur: 'Nahi chala: is run ka saboot maujood nahi.',
};

/**
 * Roadmap: what to do next, in order (see stages/roadmap.ts). Plain code: no
 * network, no model. It runs after Evidence and before Guide, and it only
 * READS the plan, the evidence and the coverage. It is a finalizer: it still
 * runs after a failure, so a failed run also gets its steps. If it breaks or
 * runs out of time the run goes on, and the client report says that the
 * roadmap is not available.
 */
export function createRoadmapAgent(): Agent<RunContext> {
  return {
    id: ROADMAP_AGENT_ID,
    name: 'Roadmap',
    critical: false,
    alwaysRun: true,
    run(context, _setProgress, control) {
      const { plan, evidence, coverage } = context;
      if (!plan || !evidence || !coverage) return Promise.resolve({ skipped: NO_EVIDENCE });
      const redact = (text: string) => control?.redact(text) ?? text;
      const input = (context.stageInput ??= buildStageInput(
        context,
        control?.failure() ?? null,
      ));
      context.roadmap = mapTexts(
        buildRoadmap({
          plan,
          findings: input.findings,
          evidence,
          coverage,
          cleanup: input.cleanup,
          ...(context.provided ? { provided: context.provided } : {}),
        }),
        redact,
      );
      return Promise.resolve();
    },
  };
}
