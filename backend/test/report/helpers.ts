import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCESS_CONFIG } from '../../src/access/access-code.guard.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import {
  GATEWAY_FACTORY,
  type GatewayFactory,
} from '../../src/audits/audits.service.js';
import type { Finding } from '../../src/prover/types.js';
import {
  LlmError,
  type LlmAnswer,
  type LlmClient,
  type LlmRequest,
} from '../../src/report/llm-client.js';
import {
  REPORT_SETUP,
  type ReportSetup,
} from '../../src/report/report-config.js';
import { FakeGateway, type FakeTable } from '../prover/fake-gateway.js';

// Made-up values that are easy to search for. They are not real keys.
export const PUBLISHABLE = 'PUBLISHABLE-KEY-VALUE-9f8e7d';
export const SECRET = 'SECRET-KEY-VALUE-1a2b3c';
export const GROQ_SECRET = 'GROQ-FAKE-KEY-VALUE-5d4c3b';
export const PROJECT_URL = 'https://abcdefghijklmnopqrst.supabase.co';

export const validBody = () => ({
  label: 'Demo project',
  projectUrl: PROJECT_URL,
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
});

export const demoTables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
  { name: 'hotels', policy: 'public-read', ownerColumn: null },
];

export async function buildApp(
  factory: GatewayFactory,
  setup: ReportSetup,
  options: { logs?: boolean } = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GATEWAY_FACTORY)
    .useValue(factory)
    .overrideProvider(REPORT_SETUP)
    .useValue(setup)
    .overrideProvider(ACCESS_CONFIG)
    .useValue({ mode: 'open' })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(options.logs ? new ConsoleLogger() : false);
  configureApp(app, {});
  await app.init();
  return app;
}

export const post = (app: INestApplication, body: unknown, path = '') =>
  request(app.getHttpServer())
    .post(`/api/v1/audits${path}`)
    .send(body as object);

export const getAudit = (app: INestApplication, id: string) =>
  request(app.getHttpServer()).get(`/api/v1/audits/${id}`);

export async function waitUntilDone(app: INestApplication, id: string) {
  for (let i = 0; i < 600; i++) {
    const res = await getAudit(app, id);
    if (res.body.status !== 'running' && res.body.status !== 'queued') {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('audit did not finish in time');
}

export async function findingsOf(
  app: INestApplication,
  id: string,
): Promise<Finding[]> {
  const res = await request(app.getHttpServer()).get(
    `/api/v1/audits/${id}/findings`,
  );
  return res.body.findings as Finding[];
}

/** Runs one audit to the end and returns its id. */
export async function runAudit(app: INestApplication): Promise<string> {
  const res = await post(app, validBody());
  await waitUntilDone(app, res.body.id);
  return res.body.id as string;
}

export function groqSetup(
  llm: LlmClient | null,
  problem: string | null = null,
) {
  return { mode: 'groq', llm, problem, secret: GROQ_SECRET } as const;
}

/** The finding ids in the user message of a request. */
export function idsIn(request: LlmRequest): string[] {
  const data = JSON.parse(request.user) as { findings: { id: string }[] };
  return data.findings.map((f) => f.id);
}

/** The text goodAnswer writes: two sentences with the verdict word. */
export const goodText = (verdict: string) =>
  `Each actor was checked on the test row. The table is ${verdict}.`;

/** A good answer for every finding of a request. */
export function goodAnswer(
  request: LlmRequest,
  text?: (id: string) => string,
): LlmAnswer {
  const data = JSON.parse(request.user) as {
    findings: { id: string; verdict: string }[];
  };
  return {
    content: JSON.stringify({
      items: data.findings.map((f) => ({
        id: f.id,
        explanation: text ? text(f.id) : goodText(f.verdict),
      })),
    }),
    finishReason: 'stop',
  };
}

/** A fake AI client. `reply` decides each answer; every request is kept. */
export class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  constructor(
    private readonly reply: (
      request: LlmRequest,
      call: number,
    ) => LlmAnswer | LlmError | Error | Promise<LlmAnswer>,
  ) {}
  async generate(request: LlmRequest): Promise<LlmAnswer> {
    this.requests.push(request);
    const answer = await this.reply(request, this.requests.length);
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

export { FakeGateway, type FakeTable };
