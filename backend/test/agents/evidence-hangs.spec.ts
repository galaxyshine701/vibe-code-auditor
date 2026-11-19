import { afterEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { EVIDENCE_UNAVAILABLE } from '../../src/stages/failsafe.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  demoTables,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';
import { buildWith } from './scenarios.js';

// The Evidence agent never returns. The Guide is the real one.
vi.mock('../../src/agents/evidence-agent.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/agents/evidence-agent.js')>();
  return {
    ...original,
    createEvidenceAgent: () => ({
      ...original.createEvidenceAgent(),
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

describe('flag on, the Evidence agent never returns', () => {
  it('the audit ends at its deadline; the Guide says: evidence unavailable, not_ready', async () => {
    app = await buildWith(() => new FakeGateway(demoTables()), ON);
    const started = Date.now();
    const first = await post(app, validBody());
    const done = await waitUntilDone(app, first.body.id);
    expect(Date.now() - started).toBeLessThan(3_000);

    expect(done.body.status).toBe('completed');
    expect(done.body.gate.decision).toBe('not_ready');
    expect(done.body.gate.reasons[0]).toEqual(EVIDENCE_UNAVAILABLE);
    const rows = done.body.modules as Row[];
    expect(rows.find((m) => m.id === 'evidence')!.status).toBe('failed');
    expect(rows.find((m) => m.id === 'evidence')!.message).toMatch(/too long/);
    expect(rows.find((m) => m.id === 'guide')!.status).toBe('completed');
  });

  it('runningId is free afterwards', async () => {
    app = await buildWith(() => new FakeGateway(demoTables()), ON);
    const first = await post(app, validBody());
    await waitUntilDone(app, first.body.id);
    const second = await post(app, validBody());
    expect(second.status).toBe(202);
    await waitUntilDone(app, second.body.id);
  });
});
