import { describe, expect, it } from 'vitest';
import { redact } from '../prover/redact.js';
import type { Agent, AgentState } from './agent.js';
import { runPipeline } from './pipeline.js';

const FAKE_KEY = 'fake-secret-key-123456';
const options = { redact: (text: string) => redact(text, [FAKE_KEY]) };

function agent(
  id: string,
  critical: boolean,
  log: string[],
  fail?: string,
): Agent<object> {
  return {
    id,
    name: id,
    critical,
    async run(_context, setProgress) {
      log.push(id);
      setProgress(50);
      if (fail) throw new Error(fail);
    },
  };
}

describe('runPipeline', () => {
  it('runs the agents in order and ends with every state completed', async () => {
    const log: string[] = [];
    const states = await runPipeline(
      [agent('a', true, log), agent('b', false, log)],
      {},
      options,
    );
    expect(log).toEqual(['a', 'b']);
    expect(states.map((s) => [s.id, s.status, s.progress])).toEqual([
      ['a', 'completed', 100],
      ['b', 'completed', 100],
    ]);
  });

  it('reports queued, running and progress through onState', async () => {
    const seen: AgentState[][] = [];
    await runPipeline(
      [agent('a', true, []), agent('b', true, [])],
      {},
      {
        ...options,
        onState: (states) => seen.push(states),
      },
    );
    expect(seen[0].map((s) => s.status)).toEqual(['queued', 'queued']);
    expect(
      seen.some((s) => s[0].status === 'running' && s[1].status === 'queued'),
    ).toBe(true);
    expect(seen.some((s) => s[0].progress === 50)).toBe(true);
  });

  it('throws the same error again when a critical agent fails, and stops', async () => {
    const log: string[] = [];
    const states: AgentState[][] = [];
    await expect(
      runPipeline(
        [agent('a', true, log, 'boom'), agent('b', false, log)],
        {},
        { ...options, onState: (s) => states.push(s) },
      ),
    ).rejects.toThrow('boom');
    expect(log).toEqual(['a']);
    const last = states[states.length - 1];
    expect(last.map((s) => s.status)).toEqual(['failed', 'queued']);
  });

  it('keeps going when a non-critical agent fails, and marks only that one failed', async () => {
    const log: string[] = [];
    const states = await runPipeline(
      [
        agent('a', true, log),
        agent('b', false, log, 'no answer'),
        agent('c', true, log),
      ],
      {},
      options,
    );
    expect(log).toEqual(['a', 'b', 'c']);
    expect(states.map((s) => s.status)).toEqual([
      'completed',
      'failed',
      'completed',
    ]);
    expect(states[1].message).toBe('no answer');
  });

  it('redacts a key from the message of a failed non-critical agent', async () => {
    const states = await runPipeline(
      [agent('b', false, [], `request failed with key ${FAKE_KEY}`)],
      {},
      options,
    );
    expect(states[0].status).toBe('failed');
    expect(states[0].message).toContain('[REDACTED]');
    expect(JSON.stringify(states)).not.toContain(FAKE_KEY);
  });

  it('redacts a key from the state of a failed critical agent too', async () => {
    const seen: AgentState[][] = [];
    await expect(
      runPipeline(
        [agent('a', true, [], `bad ${FAKE_KEY}`)],
        {},
        {
          ...options,
          onState: (s) => seen.push(s),
        },
      ),
    ).rejects.toThrow();
    expect(JSON.stringify(seen)).not.toContain(FAKE_KEY);
  });
});
