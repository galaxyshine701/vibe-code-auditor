import type { Gateway } from '../prover/gateway.js';
import { runProver } from '../prover/prover.js';
import type { ProverResult } from '../prover/types.js';
import type { Agent } from './agent.js';

/** What the agents share during one run. */
export interface RunContext {
  prover?: ProverResult;
}

/**
 * The Data Access Prover as an agent. It stays plain code: it only wraps
 * runProver and does not change how verdicts or fixes are made.
 */
export function createProverAgent(
  gateway: Gateway,
  onProgress: (percent: number) => void,
): Agent<RunContext> {
  return {
    id: 'data-access-prover',
    name: 'Data Access Prover',
    critical: true,
    async run(context, setProgress) {
      context.prover = await runProver(
        gateway,
        () => {},
        (percent) => {
          setProgress(percent);
          onProgress(percent);
        },
      );
    },
  };
}
