import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import {
  AGENTS_OFF,
  AGENTS_SETUP,
  type AgentsSetup,
} from '../../src/agents/agents-config.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AUDIT_REPOSITORY } from '../../src/audits/audit-repository.js';
import {
  GATEWAY_FACTORY,
  type GatewayFactory,
} from '../../src/audits/audits.service.js';
import type {
  Caller,
  RestMethod,
  RestResult,
  RowFilter,
} from '../../src/prover/gateway.js';
import { REPORT_SETUP } from '../../src/report/report-config.js';
import { InMemoryAuditRepository } from '../audits/in-memory-audit-repository.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';
import {
  FakeLlm,
  PUBLISHABLE,
  SECRET,
  demoTables,
  getAudit,
  goodAnswer,
  groqSetup,
  post,
  runAudit,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';

const ON: AgentsSetup = {
  enabled: true,
  proverDeadlineMs: 5_000,
  proverGraceMs: 5_000,
  reportDeadlineMs: 5_000,
  auditWatchdogMs: 60_000,
};

async function build(
  factory: GatewayFactory,
  agents: AgentsSetup,
  llm?: FakeLlm,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(factory)
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(new InMemoryAuditRepository())
    .overrideProvider(REPORT_SETUP)
    .useValue(llm ? groqSetup(llm) : { mode: 'off' })
    .overrideProvider(AGENTS_SETUP)
    .useValue(agents)
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'open' })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(new ConsoleLogger({ logLevels: [] }));
  configureApp(app, {});
  await app.init();
  return app;
}

/** The project never answers the first call (a hung connection). */
class HangingGateway extends FakeGateway {
  override fetchOpenApi(): Promise<unknown> {
    return new Promise<unknown>(() => undefined);
  }
}

class BrokenGateway extends FakeGateway {
  override fetchOpenApi(): Promise<unknown> {
    return Promise.reject(new Error(`request failed for key ${SECRET}`));
  }
}

/** Every table call takes a few milliseconds, so a run takes a while. */
class SlowGateway extends FakeGateway {
  override async restCall(
    method: RestMethod,
    table: string,
    filter: RowFilter | null,
    caller: Caller,
    body?: Record<string, unknown>,
  ): Promise<RestResult> {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return super.restCall(method, table, filter, caller, body);
  }
}

const manyTables = (count: number): FakeTable[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `t${String(i).padStart(2, '0')}`,
    policy: 'off' as const,
    ownerColumn: 'user_id',
  }));

const retestBody = {
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
};

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('flag off (the default): the old behaviour', () => {
  it('a failed Prover leaves the Report row "failed" with the old text, and no reason', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await build(() => new BrokenGateway(demoTables()), AGENTS_OFF, llm);
    const id = await runAudit(app);
    const audit = (await getAudit(app, id)).body;
    expect(audit.status).toBe('failed');
    expect(audit.modules[1]).toEqual({
      id: 'report-agent',
      name: 'Report agent',
      status: 'failed',
      progress: 0,
      message: 'Not run: the audit did not finish.',
    });
    expect(JSON.stringify(audit.modules)).not.toContain('skipped');
    expect(JSON.stringify(audit.modules)).not.toContain('reason');
  });
});

describe('flag on, everything works', () => {
  it('the response is the same as with the flag off', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await build(() => new FakeGateway(demoTables()), AGENTS_OFF, llm);
    const offBody = (await getAudit(app, await runAudit(app))).body;
    await app.close();

    app = await build(() => new FakeGateway(demoTables()), ON, llm);
    const onBody = (await getAudit(app, await runAudit(app))).body;

    const same = (b: Record<string, unknown>) =>
      JSON.stringify({
        status: b.status,
        summary: b.summary,
        modules: b.modules,
        cleanup: b.cleanup,
        ownership: b.ownership,
        plan: b.plan,
        gate: b.gate,
        lastRetest: b.lastRetest,
      });
    expect(same(onBody)).toBe(same(offBody));
    expect(onBody.modules).toHaveLength(2);
  });
});

describe('flag on, the Prover fails', () => {
  it('the Report agent is "skipped" with a reason in both languages (not "failed", not "queued")', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await build(() => new BrokenGateway(demoTables()), ON, llm);
    const id = await runAudit(app);
    const audit = (await getAudit(app, id)).body;

    expect(audit.status).toBe('failed'); // the audit status is not changed
    expect(audit.error.code).toBe('PROVER_FAILED');
    expect(audit.modules[1].id).toBe('report-agent');
    expect(audit.modules[1].status).toBe('skipped');
    expect(audit.modules[1].reason.en).toMatch(/^Not run/);
    expect(audit.modules[1].reason.ur.length).toBeGreaterThan(0);
    expect('message' in audit.modules[1]).toBe(false);
    expect(llm.requests).toHaveLength(0);
    // evidence, coverage and the gate are still written
    expect(audit.gate.decision).toBe('not_ready');
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });
});

describe('flag on, an agent that never ends', () => {
  it('a Prover that hangs: the audit ends as failed (TIMEOUT), and the next audit can start', async () => {
    app = await build(
      () => new HangingGateway(demoTables()),
      { ...ON, proverDeadlineMs: 30, proverGraceMs: 30 },
      new FakeLlm((r) => goodAnswer(r)),
    );
    const first = await post(app, validBody());
    expect(first.status).toBe(202);
    const done = await waitUntilDone(app, first.body.id);

    expect(done.body.status).toBe('failed');
    expect(done.body.error.code).toBe('TIMEOUT');
    expect(done.body.error.message).toMatch(/too long|time limit/);
    // cleanup could not be confirmed, and the note says what to do
    expect(done.body.cleanup).toBe('failed');
    expect(done.body.cleanupNote).toMatch(/vca-/);
    expect(done.body.modules[1].status).toBe('skipped');
    expect(done.body.gate.decision).toBe('not_ready');

    // runningId is free again: a new audit is accepted, not 409
    const second = await post(app, validBody());
    expect(second.status).toBe(202);
    await waitUntilDone(app, second.body.id);
  });

  it('a Report agent that hangs: only its own row fails, the audit completes, runningId is free', async () => {
    const llm = new FakeLlm(() => new Promise(() => undefined));
    app = await build(
      () => new FakeGateway(demoTables()),
      { ...ON, reportDeadlineMs: 40 },
      llm,
    );
    const id = await runAudit(app);
    const audit = (await getAudit(app, id)).body;

    expect(audit.status).toBe('completed');
    expect(audit.modules[0].status).toBe('completed');
    expect(audit.modules[1].status).toBe('failed');
    expect(audit.modules[1].message).toMatch(/too long/);
    expect(audit.summary.leaked + audit.summary.blocked).toBeGreaterThan(0);

    const next = await post(app, validBody());
    expect(next.status).toBe(202);
    await waitUntilDone(app, next.body.id);
  });

  it('a Re-test whose Prover hangs: the audit stays "completed", lastRetest says TIMEOUT, runningId is free', async () => {
    let call = 0;
    app = await build(
      () =>
        ++call === 1
          ? new FakeGateway(demoTables())
          : new HangingGateway(demoTables()),
      { ...ON, proverDeadlineMs: 30, proverGraceMs: 30 },
    );
    const id = await runAudit(app);
    const retest = await post(app, retestBody, `/${id}/retest`);
    expect(retest.status).toBe(202);
    const done = await waitUntilDone(app, id);

    expect(done.body.status).toBe('completed');
    expect(done.body.lastRetest.status).toBe('failed');
    expect(done.body.lastRetest.error.code).toBe('TIMEOUT');

    const again = await post(app, retestBody, `/${id}/retest`);
    expect(again.status).toBe(202);
    await waitUntilDone(app, id);
  });
});

describe('flag on, the audit watchdog', () => {
  it('a run that takes too long is told to stop; it cleans up and ends as failed (TIMEOUT)', async () => {
    const gateway = new SlowGateway(manyTables(20));
    app = await build(() => gateway, { ...ON, auditWatchdogMs: 60 });
    const id = await runAudit(app);
    const audit = (await getAudit(app, id)).body;

    expect(audit.status).toBe('failed');
    expect(audit.error.code).toBe('TIMEOUT');
    expect(audit.error.message).toMatch(/time limit/);
    expect(audit.cleanup).toBe('ok'); // it stopped by itself, so cleanup ran
    expect(gateway.users.size).toBe(0);
    expect(audit.gate.decision).toBe('not_ready');
  });

  it('flag off: there is no watchdog, a slow run just finishes', async () => {
    const gateway = new SlowGateway(manyTables(3));
    app = await build(() => gateway, AGENTS_OFF);
    const id = await runAudit(app);
    expect((await getAudit(app, id)).body.status).toBe('completed');
  });
});
