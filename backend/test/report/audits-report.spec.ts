import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { GATEWAY_FACTORY } from '../../src/audits/audits.service.js';
import type { Finding } from '../../src/prover/types.js';
import { REPORT_AGENT, ReportAgent } from '../../src/report/report-agent.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';
import { FakeLlm, goodAnswer } from './helpers.js';

// Made-up values that are easy to search for. They are not real keys.
const PUBLISHABLE = 'PUBLISHABLE-KEY-VALUE-9f8e7d';
const SECRET = 'SECRET-KEY-VALUE-1a2b3c';
const PROJECT_URL = 'https://abcdefghijklmnopqrst.supabase.co';

const body = () => ({
  label: 'Demo project',
  projectUrl: PROJECT_URL,
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
});

const tables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
  { name: 'hotels', policy: 'public-read', ownerColumn: null },
];

const answerByVerdict = (r: { user: string }) =>
  goodAnswer((JSON.parse(r.user) as { verdict: 'LEAKED' }).verdict);

async function buildApp(
  reportAgent?: unknown,
  options: { logs?: boolean } = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(() => new FakeGateway(tables()))
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'open' });
  if (reportAgent) {
    builder = builder.overrideProvider(REPORT_AGENT).useValue(reportAgent);
  }
  const app = (await builder.compile()).createNestApplication();
  app.useLogger(options.logs ? new ConsoleLogger() : false);
  configureApp(app, {});
  await app.init();
  return app;
}

async function runAudit(app: INestApplication) {
  const created = await request(app.getHttpServer())
    .post('/api/v1/audits')
    .send(body());
  const id = created.body.id as string;
  for (let i = 0; i < 600; i++) {
    const status = await request(app.getHttpServer()).get(
      `/api/v1/audits/${id}`,
    );
    if (status.body.status !== 'running') {
      const findings = await request(app.getHttpServer()).get(
        `/api/v1/audits/${id}/findings`,
      );
      return {
        status: status.body,
        findings: findings.body.findings as Finding[],
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('audit did not finish in time');
}

describe('Report agent inside the audits endpoint', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it('marks every finding "template" when no AI is connected', async () => {
    app = await buildApp();
    const { status, findings } = await runAudit(app);
    expect(status.status).toBe('completed');
    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.explanationSource).toBe('template');
      expect(f.explanation.en.length).toBeGreaterThan(20);
      expect(f.explanation.ur.length).toBeGreaterThan(20);
    }
  });

  it('returns the AI text in GET /findings and keeps every verdict', async () => {
    const llm = new FakeLlm(answerByVerdict);
    app = await buildApp(new ReportAgent({ llm }));
    const { status, findings } = await runAudit(app);

    expect(status.summary).toEqual({ leaked: 1, blocked: 1, inconclusive: 1 });
    const byTable = Object.fromEntries(findings.map((f) => [f.table, f]));
    expect(byTable.bookings.verdict).toBe('LEAKED');
    expect(byTable.profiles.verdict).toBe('BLOCKED');
    expect(byTable.hotels.verdict).toBe('INCONCLUSIVE');
    for (const f of findings) {
      expect(f.explanationSource).toBe('ai');
      expect(f.explanation.en).toBe(
        JSON.parse(goodAnswer(f.verdict)).explanationEn,
      );
    }
    // the fix SQL still comes from the Prover
    expect(byTable.bookings.fix?.sql).toContain('create policy');
    expect(byTable.bookings.fix?.sql).not.toContain('row-level security.');
    expect(byTable.bookings.fix?.description).toContain('row-level security');
  });

  it('still completes, with templates, when the AI fails', async () => {
    const llm = new FakeLlm(() => {
      throw new Error('provider down');
    });
    app = await buildApp(new ReportAgent({ llm }));
    const { status, findings } = await runAudit(app);
    expect(status.status).toBe('completed');
    expect(status.cleanup).toBe('ok');
    expect(findings.every((f) => f.explanationSource === 'template')).toBe(
      true,
    );
  });

  it('still completes when the whole Report step breaks', async () => {
    app = await buildApp({
      enrich: () => Promise.reject(new Error('unexpected')),
    });
    const { status, findings } = await runAudit(app);
    expect(status.status).toBe('completed');
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.explanationSource === 'template')).toBe(
      true,
    );
  });

  it('waits for the AI text before the audit is "completed"', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = new FakeLlm(async (r) => {
      await gate;
      return answerByVerdict(r);
    });
    app = await buildApp(new ReportAgent({ llm }));

    const created = await request(app.getHttpServer())
      .post('/api/v1/audits')
      .send(body());
    // wait until the AI has been asked: the Prover is finished by then
    for (let i = 0; i < 400 && llm.calls === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(llm.calls).toBe(1);
    const midway = await request(app.getHttpServer()).get(
      `/api/v1/audits/${created.body.id}`,
    );
    expect(midway.body.status).toBe('running');
    const early = await request(app.getHttpServer()).get(
      `/api/v1/audits/${created.body.id}/findings`,
    );
    expect(early.body).toEqual({ findings: [] });

    release();
    for (let i = 0; i < 400; i++) {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/audits/${created.body.id}`,
      );
      if (res.body.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const done = await request(app.getHttpServer()).get(
      `/api/v1/audits/${created.body.id}/findings`,
    );
    expect(
      done.body.findings.every((f: Finding) => f.explanationSource === 'ai'),
    ).toBe(true);
  });

  it('sends no key to the AI and shows no key in responses or logs', async () => {
    const llm = new FakeLlm(answerByVerdict);
    const written: string[] = [];
    const spies = [process.stdout, process.stderr].map((stream) => {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        written.push(String(chunk));
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      return { stream, original };
    });
    try {
      app = await buildApp(new ReportAgent({ llm }), { logs: true });
      const { status, findings } = await runAudit(app);
      const everything = [
        JSON.stringify(status),
        JSON.stringify(findings),
        JSON.stringify(llm.requests),
        written.join(''),
      ].join('\n');
      for (const secret of [PUBLISHABLE, SECRET]) {
        expect(everything).not.toContain(secret);
      }
      expect(written.join('')).toContain('aud_'); // logging really happened
    } finally {
      for (const { stream, original } of spies) stream.write = original;
    }
  });
});
