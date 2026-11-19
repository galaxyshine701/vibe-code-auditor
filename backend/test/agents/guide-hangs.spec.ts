import { afterEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { GATE_UNAVAILABLE } from '../../src/stages/failsafe.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  demoTables,
  getAudit,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';
import { buildWith } from './scenarios.js';

// The Guide never returns. Everything else is the real code.
vi.mock('../../src/agents/guide-agent.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/agents/guide-agent.js')>();
  return {
    ...original,
    createGuideAgent: () => ({
      ...original.createGuideAgent(),
      run: () => new Promise<void>(() => undefined),
    }),
  };
});

const ON = { ...AGENTS_OFF, enabled: true, finalizerDeadlineMs: 40 };
type Row = { id: string; status: string; message?: string };

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

class BrokenGateway extends FakeGateway {
  override fetchOpenApi(): Promise<unknown> {
    return Promise.reject(new Error('request failed'));
  }
}

describe('flag on, the Guide never returns', () => {
  it('the audit still ends at the Guide deadline; the stage result is the fixed not_ready', async () => {
    app = await buildWith(() => new FakeGateway(demoTables()), ON);
    const started = Date.now();
    const first = await post(app, validBody());
    const done = await waitUntilDone(app, first.body.id);
    expect(Date.now() - started).toBeLessThan(3_000);

    expect(done.body.status).toBe('completed');
    expect(done.body.gate.decision).toBe('not_ready');
    expect(done.body.gate.reasons[0]).toEqual(GATE_UNAVAILABLE);
    expect(done.body.plan.length).toBeGreaterThan(0);
    expect(done.body.ownership.status).toBe('skipped');
    const guide = (done.body.modules as Row[]).find((m) => m.id === 'guide')!;
    expect(guide.status).toBe('failed');
    expect(guide.message).toMatch(/too long/);
    // the findings and their verdicts are not touched by it
    expect(done.body.summary.leaked).toBe(1);
  });

  it('runningId is free afterwards: the next audit of the same project is accepted', async () => {
    app = await buildWith(() => new FakeGateway(demoTables()), ON);
    const first = await post(app, validBody());
    await waitUntilDone(app, first.body.id);
    const second = await post(app, validBody());
    expect(second.status).toBe(202);
    await waitUntilDone(app, second.body.id);
  });

  it('the Prover failed AND the Guide hangs: the audit is failed, with the fixed not_ready', async () => {
    app = await buildWith(() => new BrokenGateway(demoTables()), ON);
    const first = await post(app, validBody());
    const done = await waitUntilDone(app, first.body.id);
    expect(done.body.status).toBe('failed');
    expect(done.body.gate.decision).toBe('not_ready');
    expect(done.body.gate.reasons[0]).toEqual(GATE_UNAVAILABLE);
    expect((await getAudit(app, first.body.id)).status).toBe(200);
  });

  it('flag off never runs the Guide, so nothing hangs', async () => {
    app = await buildWith(() => new FakeGateway(demoTables()), AGENTS_OFF);
    const first = await post(app, validBody());
    const done = await waitUntilDone(app, first.body.id);
    expect(done.body.status).toBe('completed');
    expect((done.body.modules as Row[]).map((m) => m.id)).toEqual([
      'data-access-prover',
    ]);
  });
});
