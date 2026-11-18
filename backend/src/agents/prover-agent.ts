import type { Gateway } from '../prover/gateway.js';
import { runProver } from '../prover/prover.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';

export type { RunContext };

/**
 * The Data Access Prover as an agent. It stays plain code: it only wraps
 * runProver and does not change how verdicts or fixes are made.
 */
export function createProverAgent(
  gateway: Gateway,
  onProgress: (percent: number) => void,
  shouldStop?: () => boolean,
): Agent<RunContext> {
  return {
    id: 'data-access-prover',
    name: 'Data Access Prover',
    critical: true,
    async run(context, setProgress, control) {
      context.prover = await runProver(
        gateway,
        () => {},
        (percent) => {
          setProgress(percent);
          onProgress(percent);
        },
        // the run-level flag, or this agent's own deadline
        () => (shouldStop?.() ?? false) || (control?.shouldStop() ?? false),
      );
    },
  };
}
