import type { Agent, AgentState } from './agent.js';

export interface PipelineOptions {
  /** Applied to every failure message before it is stored in a state. */
  redact: (text: string) => string;
  /** Called after every state change, with a copy of all states. */
  onState?: (states: AgentState[]) => void;
}

/**
 * The pipeline runner: runs the agents in order and keeps one state per agent.
 * A critical agent that fails stops the run and its error is thrown again
 * unchanged, so the caller handles it as before. A non-critical agent that
 * fails only marks its own state "failed"; the run goes on.
 */
export async function runPipeline<Context>(
  agents: Agent<Context>[],
  context: Context,
  options: PipelineOptions,
): Promise<AgentState[]> {
  const states: AgentState[] = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: 'queued',
    progress: 0,
  }));
  const publish = () => options.onState?.(states.map((s) => ({ ...s })));
  publish();

  for (const [index, agent] of agents.entries()) {
    const state = states[index];
    state.status = 'running';
    publish();
    try {
      await agent.run(context, (percent) => {
        state.progress = percent;
        publish();
      });
      state.status = 'completed';
      state.progress = 100;
      publish();
    } catch (error) {
      state.status = 'failed';
      state.message = options.redact(
        error instanceof Error ? error.message : 'The agent stopped.',
      );
      publish();
      if (agent.critical) throw error;
    }
  }
  return states;
}
