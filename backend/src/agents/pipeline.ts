import type { Text } from '../stages/types.js';
import type { Agent, AgentControl, AgentState } from './agent.js';

/** One agent, or a group of agents that run together (in parallel). */
export type Stage<Context> = Agent<Context> | Agent<Context>[];

export interface PipelineOptions {
  /** Applied to every failure message before it is stored in a state. */
  redact: (text: string) => string;
  /** Called after every state change, with a copy of all states. */
  onState?: (states: AgentState[]) => void;
  /**
   * The run-level stop flag (the run's record was changed elsewhere, or the
   * audit watchdog fired). Every agent gets it as `control.shouldStop()`.
   */
  shouldStop?: () => boolean;
  /**
   * Off (default) = the old behaviour: after a critical failure the agents
   * that did not start stay "queued", and the stop flag is only looked at by
   * the agents themselves.
   * On = those agents become "skipped", each with a reason; the stop flag is
   * also looked at before every stage.
   */
  skipRemaining?: boolean;
}

export const SKIPPED_AFTER_FAILURE: Text = {
  en: 'Not run: an earlier required step failed.',
  ur: 'Nahi chala: pehle ka zaroori step fail ho gaya.',
};

export const SKIPPED_STOPPED: Text = {
  en: 'Not run: the run was stopped.',
  ur: 'Nahi chala: run rok diya gaya.',
};

/** A fixed sentence: it never carries any text from the agent. */
export const TIMEOUT_MESSAGE = 'This step took too long and was stopped.';

type Outcome = { failed: false } | { failed: true; error: unknown };

/** The outcome of `work`, or null when `ms` pass first. */
function settleWithin(
  work: Promise<Outcome>,
  ms: number,
): Promise<Outcome | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void work.then((outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    });
  });
}

/**
 * The pipeline runner: runs the stages in order and keeps one state per agent.
 * A stage is one agent, or an array of agents that run together; the next
 * stage starts when all of them have settled (allSettled), so the cleanup of
 * an agent still finishes when a sibling fails.
 *
 * A critical agent that fails stops the run and its error is thrown again
 * unchanged (after its whole group has settled), so the caller handles it as
 * before. A non-critical agent that fails only marks its own state "failed";
 * the run goes on.
 *
 * An agent with a `deadlineMs` gets its own stop flag, raised at the deadline.
 * See `Agent.abandonOnDeadline` for what happens next.
 */
export async function runPipeline<Context>(
  stages: Stage<Context>[],
  context: Context,
  options: PipelineOptions,
): Promise<AgentState[]> {
  const groups = stages.map((stage) =>
    Array.isArray(stage) ? stage : [stage],
  );
  const agents = groups.flat();
  const states: AgentState[] = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: 'queued',
    progress: 0,
  }));
  const publish = () => options.onState?.(states.map((s) => ({ ...s })));
  publish();

  const skipFrom = (start: number, reason: Text) => {
    for (const state of states.slice(start)) {
      state.status = 'skipped';
      state.reason = reason;
    }
    publish();
  };

  let offset = 0;
  for (const group of groups) {
    const start = offset;
    offset += group.length;

    if (options.skipRemaining && options.shouldStop?.()) {
      skipFrom(start, SKIPPED_STOPPED);
      break;
    }

    for (let i = 0; i < group.length; i++) states[start + i].status = 'running';
    publish();

    const settled = await Promise.allSettled(
      group.map((agent, i) =>
        runOne(agent, states[start + i], context, options, publish),
      ),
    );

    let critical: { error: unknown } | null = null;
    for (const [i, result] of settled.entries()) {
      const failure =
        result.status === 'rejected'
          ? { error: result.reason as unknown }
          : result.value;
      if (failure && group[i].critical && !critical) critical = failure;
    }
    if (critical) {
      if (options.skipRemaining) skipFrom(offset, SKIPPED_AFTER_FAILURE);
      throw critical.error;
    }
  }
  return states;
}

/** Runs one agent. Returns null when it succeeded, or the error when it failed. */
async function runOne<Context>(
  agent: Agent<Context>,
  state: AgentState,
  context: Context,
  options: PipelineOptions,
  publish: () => void,
): Promise<{ error: unknown } | null> {
  let finished = false;
  let deadlineHit = false;
  const control: AgentControl = {
    shouldStop: () => deadlineHit || (options.shouldStop?.() ?? false),
  };
  // An agent that was given up on may still call this later: ignored.
  const setProgress = (percent: number) => {
    if (finished) return;
    state.progress = percent;
    publish();
  };

  const work: Promise<Outcome> = (async () =>
    agent.run(context, setProgress, control))().then(
    (): Outcome => ({ failed: false }),
    (error: unknown): Outcome => ({ failed: true, error }),
  );

  let outcome: Outcome | null;
  if (agent.deadlineMs === undefined) {
    outcome = await work;
  } else {
    outcome = await settleWithin(work, agent.deadlineMs);
    if (outcome === null) {
      deadlineHit = true;
      if (agent.abandonOnDeadline === false) {
        outcome = await settleWithin(work, agent.graceMs ?? 0);
      }
    }
  }
  finished = true;

  if (outcome === null) {
    state.status = 'failed';
    state.code = 'TIMEOUT';
    state.message = TIMEOUT_MESSAGE;
    publish();
    return { error: new Error(TIMEOUT_MESSAGE) };
  }
  if (!outcome.failed) {
    state.status = 'completed';
    state.progress = 100;
    publish();
    return null;
  }
  state.status = 'failed';
  if (deadlineHit) {
    state.code = 'TIMEOUT';
    state.message = TIMEOUT_MESSAGE;
  } else {
    const error = outcome.error;
    state.message = options.redact(
      error instanceof Error ? error.message : 'The agent stopped.',
    );
  }
  publish();
  return { error: outcome.error };
}
