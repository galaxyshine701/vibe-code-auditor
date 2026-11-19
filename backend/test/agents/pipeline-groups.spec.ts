import { describe, expect, it } from 'vitest';
import type { Agent, AgentState } from '../../src/agents/agent.js';
import { runPipeline } from '../../src/agents/pipeline.js';
import { redact } from '../../src/prover/redact.js';

const options = { redact: (text: string) => redact(text, []) };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Ctx = Record<string, unknown>;

/** An agent that finishes by itself when `release()` is called. */
function gated(id: string, critical = false, fail?: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started: string[] = [];
  const agent: Agent<Ctx> = {
    id,
    name: id,
    critical,
    async run(context) {
      started.push(id);
      context[id] = 'started';
      await gate;
      if (fail) throw new Error(fail);
      context[id] = 'done';
    },
  };
  return { agent, release, started };
}

function quick(
  id: string,
  critical = false,
  fail?: string,
  log?: string[],
): Agent<Ctx> {
  return {
    id,
    name: id,
    critical,
    async run() {
      log?.push(id);
      if (fail) throw new Error(fail);
    },
  };
}

/** Never ends. */
function forever(id: string, extra: Partial<Agent<Ctx>> = {}): Agent<Ctx> {
  return {
    id,
    name: id,
    critical: false,
    run: () => new Promise<void>(() => undefined),
    ...extra,
  };
}

describe('parallel groups', () => {
  it('starts every agent of a group before any of them finishes', async () => {
    const a = gated('a');
    const b = gated('b');
    const context: Ctx = {};
    const done = runPipeline([[a.agent, b.agent]], context, options);
    await sleep(10);
    expect(context.a).toBe('started');
    expect(context.b).toBe('started');
    a.release();
    b.release();
    const states = await done;
    expect(states.map((s) => [s.id, s.status])).toEqual([
      ['a', 'completed'],
      ['b', 'completed'],
    ]);
  });

  it('runs the next stage only after the whole group has settled', async () => {
    const a = gated('a');
    const log: string[] = [];
    const done = runPipeline(
      [
        [a.agent, quick('b', false, undefined, log)],
        quick('c', false, undefined, log),
      ],
      {},
      options,
    );
    await sleep(10);
    expect(log).toEqual(['b']);
    a.release();
    await done;
    expect(log).toEqual(['b', 'c']);
  });

  it('keeps one state per agent, in the order they were given', async () => {
    const seen: AgentState[][] = [];
    await runPipeline(
      [quick('a'), [quick('b'), quick('c')], quick('d')],
      {},
      { ...options, onState: (s) => seen.push(s) },
    );
    expect(seen[0].map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(seen[seen.length - 1].map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
  });

  it('a failed non-critical agent in a group does not touch its sibling', async () => {
    const states = await runPipeline(
      [[quick('a', false, 'no answer'), quick('b')], quick('c')],
      {},
      options,
    );
    expect(states.map((s) => s.status)).toEqual([
      'failed',
      'completed',
      'completed',
    ]);
    expect(states[0].message).toBe('no answer');
  });

  it('waits for the sibling to finish before a critical failure is thrown again', async () => {
    const slow = gated('slow');
    const seen: AgentState[][] = [];
    const boom = new Error('boom');
    const failing: Agent<Ctx> = {
      id: 'critical',
      name: 'critical',
      critical: true,
      async run() {
        throw boom;
      },
    };
    let settled = false;
    const done = runPipeline(
      [[failing, slow.agent]],
      {},
      {
        ...options,
        onState: (s) => seen.push(s),
      },
    ).then(
      () => 'resolved',
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await sleep(15);
    // the sibling is still working: the run is not over yet (its cleanup must finish)
    expect(settled).toBe(false);
    slow.release();
    expect(await done).toBe(boom);
    const last = seen[seen.length - 1];
    expect(last.map((s) => s.status)).toEqual(['failed', 'completed']);
  });

  it('a plain array of agents behaves exactly as before', async () => {
    const log: string[] = [];
    await runPipeline(
      [quick('a', false, undefined, log), quick('b', false, undefined, log)],
      {},
      options,
    );
    expect(log).toEqual(['a', 'b']);
  });
});

describe('after a critical failure', () => {
  it('flag off (default): the later agents stay "queued", as before', async () => {
    const seen: AgentState[][] = [];
    await expect(
      runPipeline(
        [quick('a', true, 'boom'), quick('b'), [quick('c'), quick('d')]],
        {},
        { ...options, onState: (s) => seen.push(s) },
      ),
    ).rejects.toThrow('boom');
    const last = seen[seen.length - 1];
    expect(last.map((s) => s.status)).toEqual([
      'failed',
      'queued',
      'queued',
      'queued',
    ]);
    expect(last.every((s) => s.reason === undefined)).toBe(true);
  });

  it('skipRemaining: the later agents are "skipped", each with a reason in both languages', async () => {
    const seen: AgentState[][] = [];
    await expect(
      runPipeline(
        [quick('a', true, 'boom'), quick('b'), [quick('c'), quick('d')]],
        {},
        { ...options, skipRemaining: true, onState: (s) => seen.push(s) },
      ),
    ).rejects.toThrow('boom');
    const last = seen[seen.length - 1];
    expect(last.map((s) => s.status)).toEqual([
      'failed',
      'skipped',
      'skipped',
      'skipped',
    ]);
    for (const state of last.slice(1)) {
      expect(state.reason?.en).toMatch(/^Not run/);
      expect(state.reason?.ur.length).toBeGreaterThan(0);
    }
  });

  it('skipRemaining: a non-critical failure skips nothing', async () => {
    const states = await runPipeline(
      [quick('a', false, 'no'), quick('b')],
      {},
      { ...options, skipRemaining: true },
    );
    expect(states.map((s) => s.status)).toEqual(['failed', 'completed']);
  });

  it('skipRemaining: when the run is told to stop between stages, the rest is skipped', async () => {
    let stop = false;
    const log: string[] = [];
    const first: Agent<Ctx> = {
      id: 'a',
      name: 'a',
      critical: true,
      async run() {
        stop = true;
      },
    };
    const states = await runPipeline(
      [first, quick('b', false, undefined, log)],
      {},
      { ...options, skipRemaining: true, shouldStop: () => stop },
    );
    expect(log).toEqual([]);
    expect(states.map((s) => s.status)).toEqual(['completed', 'skipped']);
  });

  it('without skipRemaining the stop flag is not looked at between stages', async () => {
    const log: string[] = [];
    const states = await runPipeline(
      [quick('a'), quick('b', false, undefined, log)],
      {},
      { ...options, shouldStop: () => true },
    );
    expect(log).toEqual(['b']);
    expect(states.map((s) => s.status)).toEqual(['completed', 'completed']);
  });
});

describe('the deadline of one agent', () => {
  it('an agent that never ends: the pipeline goes on, its state is failed with code TIMEOUT', async () => {
    const log: string[] = [];
    const states = await runPipeline(
      [
        forever('stuck', { deadlineMs: 25 }),
        quick('next', false, undefined, log),
      ],
      {},
      options,
    );
    expect(log).toEqual(['next']);
    expect(states[0].status).toBe('failed');
    expect(states[0].code).toBe('TIMEOUT');
    expect(states[0].message).toMatch(/too long/);
    expect(states[1].status).toBe('completed');
  });

  it('a critical agent that never ends: the pipeline throws, and does not hang', async () => {
    const seen: AgentState[][] = [];
    await expect(
      runPipeline(
        [forever('stuck', { critical: true, deadlineMs: 25 }), quick('next')],
        {},
        { ...options, skipRemaining: true, onState: (s) => seen.push(s) },
      ),
    ).rejects.toThrow(/too long/);
    const last = seen[seen.length - 1];
    expect(last.map((s) => [s.status, s.code])).toEqual([
      ['failed', 'TIMEOUT'],
      ['skipped', undefined],
    ]);
  });

  it('progress that an abandoned agent reports later is ignored', async () => {
    let late!: (percent: number) => void;
    const stuck: Agent<Ctx> = {
      id: 'stuck',
      name: 'stuck',
      critical: false,
      deadlineMs: 20,
      run: (_c, setProgress) => {
        late = setProgress;
        return new Promise<void>(() => undefined);
      },
    };
    const seen: AgentState[][] = [];
    const states = await runPipeline(
      [stuck],
      {},
      {
        ...options,
        onState: (s) => seen.push(s),
      },
    );
    const count = seen.length;
    late(77);
    expect(seen).toHaveLength(count);
    expect(states[0].progress).not.toBe(77);
    expect(states[0].status).toBe('failed');
  });

  it('the agent gets its own stop flag: it turns true when the deadline is hit', async () => {
    let sawStop = false;
    const agent: Agent<Ctx> = {
      id: 'loop',
      name: 'loop',
      critical: false,
      deadlineMs: 20,
      abandonOnDeadline: false,
      graceMs: 500,
      async run(_c, _p, control) {
        while (!control?.shouldStop()) await sleep(2);
        sawStop = true;
      },
    };
    const states = await runPipeline([agent], {}, options);
    expect(sawStop).toBe(true);
    // it noticed and ended by itself, so it is not a failure
    expect(states[0].status).toBe('completed');
  });

  it('the stop flag is the run-level flag OR the deadline of this agent', async () => {
    let runStop = false;
    const flags: boolean[] = [];
    const agent: Agent<Ctx> = {
      id: 'a',
      name: 'a',
      critical: false,
      async run(_c, _p, control) {
        flags.push(control?.shouldStop() ?? false);
        runStop = true;
        flags.push(control?.shouldStop() ?? false);
      },
    };
    await runPipeline([agent], {}, { ...options, shouldStop: () => runStop });
    expect(flags).toEqual([false, true]);
  });

  it('abandonOnDeadline false: the pipeline waits for the agent to end by itself (the Prover must clean up), and keeps its error', async () => {
    const own = new Error('stopped by the flag');
    const events: string[] = [];
    const agent: Agent<Ctx> = {
      id: 'prover',
      name: 'prover',
      critical: true,
      deadlineMs: 20,
      abandonOnDeadline: false,
      graceMs: 500,
      async run(_c, _p, control) {
        while (!control?.shouldStop()) await sleep(2);
        await sleep(30); // "cleanup"
        events.push('cleanup done');
        throw own;
      },
    };
    const seen: AgentState[][] = [];
    const caught = await runPipeline(
      [agent],
      {},
      {
        ...options,
        onState: (s) => seen.push(s),
      },
    ).catch((error: unknown) => error);
    expect(events).toEqual(['cleanup done']); // the pipeline did not return before it
    expect(caught).toBe(own); // same error object, so its cleanup info survives
    const last = seen[seen.length - 1][0];
    expect(last.status).toBe('failed');
    expect(last.code).toBe('TIMEOUT');
  });

  it('abandonOnDeadline false: when even the grace time runs out, it stops waiting', async () => {
    const agent: Agent<Ctx> = {
      id: 'prover',
      name: 'prover',
      critical: true,
      deadlineMs: 15,
      abandonOnDeadline: false,
      graceMs: 25,
      run: () => new Promise<void>(() => undefined),
    };
    await expect(runPipeline([agent], {}, options)).rejects.toThrow(/too long/);
  });

  it('an agent without a deadline is not timed (flag off keeps the old behaviour)', async () => {
    const slow: Agent<Ctx> = {
      id: 'slow',
      name: 'slow',
      critical: true,
      async run() {
        await sleep(40);
      },
    };
    const states = await runPipeline([slow], {}, options);
    expect(states[0].status).toBe('completed');
    expect(states[0].code).toBeUndefined();
  });

  it('an agent that ends before its deadline is completed and its timer is gone', async () => {
    const states = await runPipeline(
      [{ ...quick('a'), deadlineMs: 10_000 }],
      {},
      options,
    );
    expect(states[0].status).toBe('completed');
  });
});

describe('giving up on an agent', () => {
  it('tells the caller, with a promise that ends when the agent finally ends', async () => {
    let end!: () => void;
    const agent: Agent<Ctx> = {
      id: 'prover',
      name: 'prover',
      critical: false,
      deadlineMs: 15,
      run: () => new Promise<void>((resolve) => (end = resolve)),
    };
    const abandoned: { id: string; done: Promise<void> }[] = [];
    await runPipeline(
      [agent],
      {},
      {
        ...options,
        onAbandoned: (id, done) => abandoned.push({ id, done }),
      },
    );
    expect(abandoned.map((a) => a.id)).toEqual(['prover']);
    let over = false;
    void abandoned[0].done.then(() => (over = true));
    await sleep(10);
    expect(over).toBe(false);
    end();
    await sleep(10);
    expect(over).toBe(true);
  });

  it('the promise also ends when the abandoned agent throws (it never rejects)', async () => {
    let fail!: (error: Error) => void;
    const agent: Agent<Ctx> = {
      id: 'x',
      name: 'x',
      critical: false,
      deadlineMs: 10,
      run: () => new Promise<void>((_r, reject) => (fail = reject)),
    };
    const abandoned: Promise<void>[] = [];
    await runPipeline(
      [agent],
      {},
      {
        ...options,
        onAbandoned: (_id, done) => abandoned.push(done),
      },
    );
    fail(new Error('late'));
    await expect(abandoned[0]).resolves.toBeUndefined();
  });

  it('is not called for an agent that ended, or that ended by itself after its deadline', async () => {
    const calls: string[] = [];
    const cooperative: Agent<Ctx> = {
      id: 'coop',
      name: 'coop',
      critical: false,
      deadlineMs: 10,
      abandonOnDeadline: false,
      graceMs: 500,
      async run(_c, _p, control) {
        while (!control?.shouldStop()) await sleep(2);
      },
    };
    await runPipeline(
      [quick('fine'), cooperative],
      {},
      {
        ...options,
        onAbandoned: (id) => calls.push(id),
      },
    );
    expect(calls).toEqual([]);
  });
});
