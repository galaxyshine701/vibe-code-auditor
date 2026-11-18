import type { Text } from '../stages/types.js';

/**
 * `skipped` = the agent did not run on purpose (an earlier required step
 * failed, or the run was stopped). `reason` says why. This is the status of
 * ONE agent row only: the audit's own status never gets this value.
 */
export type AgentStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'skipped';

/** What the pipeline runner remembers about one agent. */
export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  progress: number;
  /** Only when the agent failed. Already redacted. */
  message?: string;
  /** Only when the agent failed because its own time limit ran out. */
  code?: 'TIMEOUT';
  /** Only when the agent was skipped: why, in both languages. */
  reason?: Text;
}

/** What the runner gives an agent while it runs. */
export interface AgentControl {
  /**
   * True when the whole run was told to stop, or when THIS agent's own
   * deadline has passed. Long agents look at it between steps and end early
   * (the Prover still cleans up). It is a plain flag: nothing is aborted.
   */
  shouldStop(): boolean;
  /** Takes the secrets of this run out of a text. Use it on every text you copy. */
  redact(text: string): string;
  /**
   * A copy of the states of all agents so far, including the row of the agent
   * that asks. Changing the copy changes nothing. Used to READ, never to decide
   * a result.
   */
  states(): AgentState[];
  /** The error of the critical agent that failed, or null. Only a finalizer sees one. */
  failure(): unknown;
}

/**
 * What `run` may return instead of nothing: the agent did not do its work on
 * purpose (for example ownership is not checked yet). Its row becomes
 * `skipped` with this reason. This is not a failure.
 */
export interface AgentSkipped {
  skipped: Text;
}

/**
 * One step of a run. The pipeline runner calls the agents one after the other,
 * or all agents of one group together. Which agent runs next is decided by
 * code, never by a model.
 */
export interface Agent<Context> {
  id: string;
  name: string;
  /** If a critical agent fails, the whole run fails. */
  critical: boolean;
  /**
   * Time limit of this agent, in milliseconds. None = no limit (the old
   * behaviour). At the limit the agent's stop flag goes up.
   */
  deadlineMs?: number;
  /**
   * What happens at the deadline. true (default): the runner stops waiting at
   * once and marks the agent failed (TIMEOUT). false: the runner waits up to
   * `graceMs` more for the agent to end by itself, because it has cleanup to
   * do (the Data Access Prover); only after that it stops waiting.
   */
  abandonOnDeadline?: boolean;
  graceMs?: number;
  /**
   * A finalizer: it still runs after a critical failure or when the run was
   * told to stop (the other agents are skipped then), and its own stop flag
   * ignores the run-level flag. Give it a short `deadlineMs`: it must not be
   * able to keep a finished run waiting.
   */
  alwaysRun?: boolean;
  /**
   * `control` is always given by the pipeline runner; it is optional in the
   * type only so a test can call run() by hand.
   */
  run(
    context: Context,
    setProgress: (percent: number) => void,
    control?: AgentControl,
  ): Promise<void | AgentSkipped>;
}
