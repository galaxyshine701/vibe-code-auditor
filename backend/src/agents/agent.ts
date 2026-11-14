export type AgentStatus = 'queued' | 'running' | 'completed' | 'failed';

/** What the pipeline runner remembers about one agent. */
export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  progress: number;
  /** Only when the agent failed. Already redacted. */
  message?: string;
}

/**
 * One step of a run. The pipeline runner calls the agents one after the other.
 * Which agent runs next is decided by code, never by a model.
 */
export interface Agent<Context> {
  id: string;
  name: string;
  /** If a critical agent fails, the whole run fails. */
  critical: boolean;
  run(context: Context, setProgress: (percent: number) => void): Promise<void>;
}
