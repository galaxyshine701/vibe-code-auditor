import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
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

// The Roadmap agent never returns, or throws (the test says which).
const mode = vi.hoisted(() => ({ value: 'hang' as 'hang' | 'throw' }));
vi.mock('../../src/agents/roadmap-agent.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/agents/roadmap-agent.js')>();
  return {
    ...original,
    createRoadmapAgent: () => ({
      ...original.createRoadmapAgent(),
      run: () =>
        mode.value === 'hang'
          ? new Promise<void>(() => undefined)
          : Promise.reject(
              new Error('roadmap broke with key SECRET-KEY-VALUE-1a2b3c'),
            ),
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

const get = (a: INestApplication, id: string, path: string) =>
  request(a.getHttpServer()).get(`/api/v1/audits/${id}/${path}`);

for (const how of ['hang', 'throw'] as const) {
  describe(`flag on, the Roadmap agent ${how === 'hang' ? 'never returns' : 'throws'}`, () => {
    it('the audit completes; roadmap is empty; the client report says "Roadmap not available."; the gate is unchanged', async () => {
      mode.value = how;
      app = await buildWith(() => new FakeGateway(demoTables()), ON);
      const started = Date.now();
      const first = await post(app, validBody());
      const done = await waitUntilDone(app, first.body.id);
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(done.body.status).toBe('completed');

      // the row says it failed, with a fixed sentence for a timeout
      const row = (done.body.modules as Row[]).find((m) => m.id === 'roadmap')!;
      expect(row.status).toBe('failed');
      if (how === 'hang') expect(row.message).toMatch(/too long/);
      expect(JSON.stringify(done.body)).not.toContain('SECRET-KEY-VALUE');

      // the stage result is as it always was
      expect(done.body.gate.decision).toBe('not_ready');
      expect(done.body.gate.reasons.length).toBeGreaterThan(0);
      expect(done.body.summary.leaked).toBe(1);
      expect((await get(app, first.body.id, 'evidence')).status).toBe(200);

      const roadmap = await get(app, first.body.id, 'roadmap');
      expect(roadmap.status).toBe(200);
      expect(roadmap.body).toEqual({ schemaVersion: 1, items: [], truncated: 0 });

      const report = await get(app, first.body.id, 'client-report');
      expect(report.status).toBe(200);
      expect(report.body.decision).toBe(done.body.gate.decision);
      expect(report.body.topActions).toEqual([]);
      expect(report.body.limits.at(-1)).toEqual(ROADMAP_NOT_AVAILABLE);
      // the counts are still there: only the roadmap is missing
      expect(report.body.findings.tables).toEqual({
        leaked: 1,
        blocked: 1,
        inconclusive: 1,
      });
      for (const text of allStrings(report.body)) {
        expect(text).not.toMatch(BANNED_EN);
        expect(text).not.toMatch(BANNED_UR);
      }
    });

    it('the Guide still runs after it (it is a finalizer), and the next audit is accepted', async () => {
      mode.value = how;
      app = await buildWith(() => new FakeGateway(demoTables()), ON);
      const first = await post(app, validBody());
      const done = await waitUntilDone(app, first.body.id);
      expect((done.body.modules as Row[]).find((m) => m.id === 'guide')!.status).toBe('completed');
      const second = await post(app, validBody());
      expect(second.status).toBe(202);
      await waitUntilDone(app, second.body.id);
    });
  });
}
