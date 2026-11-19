import { describe, expect, it } from 'vitest';
import type { Agent, AgentState } from '../../src/agents/agent.js';
import { runPipeline } from '../../src/agents/pipeline.js';
import { redact } from '../../src/prover/redact.js';

const KEY = 'fake-secret-key-123456';
const options = { redact: (text: string) => redact(text, [KEY]) };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Ctx = Record<string, unknown>;

const agent = (
  id: string,
  extra: Partial<Agent<Ctx>> = {},
  log?: string[],
  fail?: string,
): Agent<Ctx> => ({
  id,
  name: id,
  critical: false,
  async run() {
    log?.push(id);
    if (fail) throw new Error(fail);
  },
  ...extra,
});

describe('alwaysRun agents (finalizers)', () => {
  it('run after a critical failure; later agents are skipped; the error is thrown again unchanged', async () => {
    const log: string[] = [];
    const boom = new Error('boom');
    const seen: AgentState[][] = [];
    const caught = await runPipeline(
      [
        {
          ...agent('prover', { critical: true }),
          run: () => Promise.reject(boom),
        },
        agent('report', {}, log),
        agent('evidence', { alwaysRun: true }, log),
        agent('guide', { alwaysRun: true }, log),
      ],
      {},
      { ...options, skipRemaining: true, onState: (s) => seen.push(s) },
    ).catch((error: unknown) => error);

    expect(caught).toBe(boom);
    expect(log).toEqual(['evidence', 'guide']); // report did not run
    const last = seen[seen.length - 1];
    expect(last.map((s) => [s.id, s.status])).toEqual([
      ['prover', 'failed'],
      ['report', 'skipped'],
      ['evidence', 'completed'],
      ['guide', 'completed'],
    ]);
  });

  it('without skipRemaining the others stay queued, but a finalizer still runs', async () => {
    const seen: AgentState[][] = [];
    await expect(
      runPipeline(
        [
          agent('prover', { critical: true }, undefined, 'boom'),
          agent('report'),
          agent('guide', { alwaysRun: true }),
        ],
        {},
        { ...options, onState: (s) => seen.push(s) },
      ),
    ).rejects.toThrow('boom');
    const last = seen[seen.length - 1];
    expect(last.map((s) => s.status)).toEqual([
      'failed',
      'queued',
      'completed',
    ]);
  });

  it('run in a stopped run too (the run-level stop flag does not keep them away)', async () => {
    const log: string[] = [];
    const states = await runPipeline(
      [
        agent('first'),
        agent('middle', {}, log),
        agent('guide', { alwaysRun: true }, log),
      ],
      {},
      { ...options, skipRemaining: true, shouldStop: () => true },
    );
    expect(log).toEqual(['guide']);
    expect(states.map((s) => s.status)).toEqual([
      'skipped',
      'skipped',
      'completed',
    ]);
  });

  it('their own stop flag ignores the run-level flag, and goes up at their own deadline', async () => {
    const flags: boolean[] = [];
    const finalizer: Agent<Ctx> = {
      id: 'guide',
      name: 'guide',
      critical: false,
      alwaysRun: true,
      deadlineMs: 20,
      abandonOnDeadline: false,
      graceMs: 500,
      async run(_c, _p, control) {
        flags.push(control?.shouldStop() ?? true); // run-level flag is true: ignored
        await sleep(40);
        flags.push(control?.shouldStop() ?? false); // own deadline has passed
      },
    };
    await runPipeline([finalizer], {}, { ...options, shouldStop: () => true });
    expect(flags).toEqual([false, true]);
  });

  it('a finalizer that fails does not hide the first error, and fails only its own row', async () => {
    const seen: AgentState[][] = [];
    const first = new Error('first');
    const caught = await runPipeline(
      [
        {
          ...agent('prover', { critical: true }),
          run: () => Promise.reject(first),
        },
        agent('guide', { alwaysRun: true }, undefined, 'second'),
      ],
      {},
      { ...options, onState: (s) => seen.push(s) },
    ).catch((error: unknown) => error);
    expect(caught).toBe(first);
    const last = seen[seen.length - 1];
    expect(last.map((s) => s.status)).toEqual(['failed', 'failed']);
    expect(last[1].message).toBe('second');
  });

  it('a finalizer that never returns: the pipeline still ends at its deadline (after a failure)', async () => {
    const start = Date.now();
    const seen: AgentState[][] = [];
    const first = new Error('first');
    const caught = await runPipeline(
      [
        {
          ...agent('prover', { critical: true }),
          run: () => Promise.reject(first),
        },
        agent('guide', {
          alwaysRun: true,
          deadlineMs: 30,
          run: () => new Promise<void>(() => undefined),
        }),
      ],
      {},
      { ...options, onState: (s) => seen.push(s) },
    ).catch((error: unknown) => error);
    expect(caught).toBe(first);
    expect(Date.now() - start).toBeLessThan(1_000);
    const last = seen[seen.length - 1][1];
    expect([last.status, last.code]).toEqual(['failed', 'TIMEOUT']);
  });

  it('a finalizer that never returns: a healthy run still ends at its deadline', async () => {
    const states = await runPipeline(
      [
        agent('a'),
        agent('guide', {
          alwaysRun: true,
          deadlineMs: 30,
          run: () => new Promise<void>(() => undefined),
        }),
      ],
      {},
      options,
    );
    expect(states.map((s) => [s.status, s.code])).toEqual([
      ['completed', undefined],
      ['failed', 'TIMEOUT'],
    ]);
  });

  it('in a group, after a failure, only the alwaysRun member runs', async () => {
    const log: string[] = [];
    const seen: AgentState[][] = [];
    await expect(
      runPipeline(
        [
          agent('prover', { critical: true }, undefined, 'boom'),
          [agent('x', {}, log), agent('y', { alwaysRun: true }, log)],
        ],
        {},
        { ...options, skipRemaining: true, onState: (s) => seen.push(s) },
      ),
    ).rejects.toThrow('boom');
    expect(log).toEqual(['y']);
    expect(seen[seen.length - 1].map((s) => s.status)).toEqual([
      'failed',
      'skipped',
      'completed',
    ]);
  });
});

describe('an agent that finishes as "skipped"', () => {
  const reason = { en: 'Not checked yet.', ur: 'Abhi check nahi hota.' };

  it('its row is skipped with the reason, progress 0, and the run goes on', async () => {
    const log: string[] = [];
    const states = await runPipeline(
      [
        agent('ownership', { run: () => Promise.resolve({ skipped: reason }) }),
        agent('next', {}, log),
      ],
      {},
      { ...options, skipRemaining: true },
    );
    expect(states[0]).toMatchObject({
      status: 'skipped',
      progress: 0,
      reason,
    });
    expect(log).toEqual(['next']);
  });

  it('is not a failure: a critical agent that is skipped does not stop the run', async () => {
    const states = await runPipeline(
      [
        agent('a', {
          critical: true,
          run: () => Promise.resolve({ skipped: reason }),
        }),
        agent('b'),
      ],
      {},
      options,
    );
    expect(states.map((s) => s.status)).toEqual(['skipped', 'completed']);
  });
});

describe('what an agent can see while it runs', () => {
  it('states(): a copy of the states so far (including its own row), failure(): null', async () => {
    let seen: AgentState[] = [];
    let failure: unknown = 'unset';
    await runPipeline(
      [
        agent('a'),
        agent('b', {
          run: (_c, _p, control) => {
            seen = control?.states() ?? [];
            failure = control?.failure();
            seen[0].status = 'failed'; // a change to the copy changes nothing
            return Promise.resolve();
          },
        }),
      ],
      {},
      options,
    );
    expect(seen.map((s) => [s.id, s.status])).toEqual([
      ['a', 'failed'], // the copy we changed ourselves
      ['b', 'running'],
    ]);
    expect(failure).toBeNull();
  });

  it('states() is not changed by what the agent does to the copy', async () => {
    const states = await runPipeline(
      [
        agent('a'),
        agent('b', {
          run: (_c, _p, control) => {
            control?.states().forEach((s) => (s.status = 'failed'));
            return Promise.resolve();
          },
        }),
      ],
      {},
      options,
    );
    expect(states.map((s) => s.status)).toEqual(['completed', 'completed']);
  });

  it('failure(): the critical error, for a finalizer; redact() uses the run secrets', async () => {
    const boom = new Error('boom');
    let failure: unknown;
    let cleaned = '';
    await runPipeline(
      [
        {
          ...agent('prover', { critical: true }),
          run: () => Promise.reject(boom),
        },
        agent('guide', {
          alwaysRun: true,
          run: (_c, _p, control) => {
            failure = control?.failure();
            cleaned = control?.redact(`the key is ${KEY}`) ?? '';
            return Promise.resolve();
          },
        }),
      ],
      {},
      options,
    ).catch(() => undefined);
    expect(failure).toBe(boom);
    expect(cleaned).toBe('the key is [REDACTED]');
  });

  it('with no alwaysRun agent at all, nothing changes (the old behaviour)', async () => {
    const seen: AgentState[][] = [];
    await expect(
      runPipeline(
        [agent('a', { critical: true }, undefined, 'boom'), agent('b')],
        {},
        { ...options, onState: (s) => seen.push(s) },
      ),
    ).rejects.toThrow('boom');
    expect(seen[seen.length - 1].map((s) => s.status)).toEqual([
      'failed',
      'queued',
    ]);
  });
});
