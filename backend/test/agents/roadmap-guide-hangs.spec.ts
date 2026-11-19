import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { GATE_UNAVAILABLE } from '../../src/stages/failsafe.js';
import { ROADMAP_NOT_AVAILABLE } from '../../src/stages/client-report.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  demoTables,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';
import {
  allStrings,
  BANNED_EN,
  BANNED_UR,
} from '../stages/roadmap-fixtures.js';
import { buildWith } from './scenarios.js';

// The Guide never returns: both new fields are the fixed ones.
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
let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('flag on, the Guide never returns', () => {
  it('roadmap is empty and the client report is the fixed not_ready one', async () => {
    app = await buildWith(() => new FakeGateway(demoTables()), ON);
    const first = await post(app, validBody());
    const done = await waitUntilDone(app, first.body.id);
    expect(done.body.status).toBe('completed');
    const base = `/api/v1/audits/${first.body.id}`;
    const roadmap = await request(app.getHttpServer()).get(`${base}/roadmap`);
    expect(roadmap.status).toBe(200);
    expect(roadmap.body).toEqual({ schemaVersion: 1, items: [], truncated: 0 });
    const report = await request(app.getHttpServer()).get(`${base}/client-report`);
    expect(report.status).toBe(200);
    expect(report.body.decision).toBe('not_ready');
    expect(report.body.reasons).toEqual([GATE_UNAVAILABLE]);
    expect(report.body.findings).toEqual({ tables: null, site: null });
    expect(report.body.topActions).toEqual([]);
    expect(report.body.limits).toEqual([ROADMAP_NOT_AVAILABLE]);
    for (const text of allStrings(report.body)) {
      expect(text).not.toMatch(BANNED_EN);
      expect(text).not.toMatch(BANNED_UR);
    }
  });
});
