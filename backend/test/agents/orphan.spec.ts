import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import {
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
import { REPORT_SETUP } from '../../src/report/report-config.js';
import { InMemoryAuditRepository } from '../audits/in-memory-audit-repository.js';
import { FakeGateway } from '../prover/fake-gateway.js';
import {
  PROJECT_URL,
  PUBLISHABLE,
  SECRET,
  demoTables,
  getAudit,
  post,
  validBody,
  waitUntilDone,
} from '../report/helpers.js';

const OTHER_URL = 'https://zyxwvutsrqponmlkjihg.supabase.co';

const SETUP: AgentsSetup = {
  enabled: true,
  proverDeadlineMs: 30,
  proverGraceMs: 30,
  reportDeadlineMs: 5_000,
  auditWatchdogMs: 60_000,
  orphanHoldMs: 5_000,
};

async function build(
  factory: GatewayFactory,
  agents: AgentsSetup,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(factory)
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(new InMemoryAuditRepository())
    .overrideProvider(REPORT_SETUP)
    .useValue({ mode: 'off' })
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

/**
 * A Prover that does not obey the stop flag while it waits: its first call
 * only answers when the test lets it (or never). After that it goes on, finds
 * the stop flag up, and cleans up, like the real Prover does.
 */
class StubbornGateway extends FakeGateway {
  release!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  constructor(private readonly forever = false) {
    super(demoTables());
  }
  override async fetchOpenApi(): Promise<unknown> {
    if (this.forever) return new Promise<unknown>(() => undefined);
    await this.gate;
    return super.fetchOpenApi();
  }
}

const forUrl =
  (urls: Record<string, () => FakeGateway>): GatewayFactory =>
  (config) =>
    (urls[config.supabaseUrl] ?? (() => new FakeGateway(demoTables())))();

const body = (projectUrl: string) => ({ ...validBody(), projectUrl });

async function until(check: () => Promise<boolean>, ms = 3_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('a Prover that is given up on is still running (an orphan)', () => {
  it('holds the project: a new audit of the same project gets 409, another project is accepted', async () => {
    app = await build(
      forUrl({ [PROJECT_URL]: () => new StubbornGateway(true) }),
      SETUP,
    );
    const first = await post(app, body(PROJECT_URL));
    const done = await waitUntilDone(app, first.body.id);
    expect(done.body.status).toBe('failed');
    expect(done.body.error.code).toBe('TIMEOUT');

    // runningId is free, but the orphan may still be touching the project
    const same = await post(app, body(PROJECT_URL));
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe('AUDIT_IN_PROGRESS');
    expect(JSON.stringify(same.body)).not.toContain(SECRET);

    // the same project written in capitals is the same project
    const shouting = await post(
      app,
      body(PROJECT_URL.replace('abcdefghijklmnopqrst', 'ABCDEFGHIJKLMNOPQRST')),
    );
    expect(shouting.status).toBe(409);

    const other = await post(app, body(OTHER_URL));
    expect(other.status).toBe(202);
    const otherDone = await waitUntilDone(app, other.body.id);
    expect(otherDone.body.status).toBe('completed');
  });

  it('is let go when the orphan ends, and the orphan cleaned up by itself', async () => {
    const gateway = new StubbornGateway();
    app = await build(forUrl({ [PROJECT_URL]: () => gateway }), SETUP);
    const first = await post(app, body(PROJECT_URL));
    await waitUntilDone(app, first.body.id);
    expect((await post(app, body(PROJECT_URL))).status).toBe(409);

    gateway.release(); // the orphan goes on, sees the stop flag, ends
    let accepted = '';
    const free = await until(async () => {
      const res = await post(app!, body(PROJECT_URL));
      if (res.status === 202) accepted = res.body.id as string;
      return res.status === 202;
    });
    expect(free).toBe(true);
    await waitUntilDone(app, accepted);
    expect(gateway.users.size).toBe(0);
  });

  it('is let go after the hard cap even if the orphan never ends', async () => {
    app = await build(
      forUrl({ [PROJECT_URL]: () => new StubbornGateway(true) }),
      { ...SETUP, orphanHoldMs: 80 },
    );
    const first = await post(app, body(PROJECT_URL));
    await waitUntilDone(app, first.body.id);
    expect((await post(app, body(PROJECT_URL))).status).toBe(409);

    let accepted = '';
    const free = await until(async () => {
      const res = await post(app!, body(PROJECT_URL));
      if (res.status === 202) accepted = res.body.id as string;
      return res.status === 202;
    });
    expect(free).toBe(true);
    await waitUntilDone(app, accepted);
  });

  it('a Re-test of the held project is refused too', async () => {
    let call = 0;
    app = await build(
      () =>
        ++call === 1
          ? new FakeGateway(demoTables())
          : new StubbornGateway(true),
      SETUP,
    );
    const first = await post(app, validBody());
    await waitUntilDone(app, first.body.id);
    const retestBody = {
      anonKey: PUBLISHABLE,
      serviceKey: SECRET,
      confirmTestProject: true,
    };
    const retest = await post(app, retestBody, `/${first.body.id}/retest`);
    expect(retest.status).toBe(202);
    const done = await waitUntilDone(app, first.body.id);
    expect(done.body.lastRetest.error.code).toBe('TIMEOUT');

    const again = await post(app, retestBody, `/${first.body.id}/retest`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('AUDIT_IN_PROGRESS');
    // reading the audit still works while the project is held
    expect((await getAudit(app, first.body.id)).status).toBe(200);
  });

  it('flag off: nothing is ever given up on, so nothing is held', async () => {
    app = await build(forUrl({}), { ...SETUP, enabled: false });
    const first = await post(app, validBody());
    await waitUntilDone(app, first.body.id);
    const second = await post(app, validBody());
    expect(second.status).toBe(202);
    await waitUntilDone(app, second.body.id);
  });
});
