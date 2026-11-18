import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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
  validBody,
  waitUntilDone,
} from '../report/helpers.js';

/** An app with the agent flag and the Report agent set as the test says. */
export async function buildWith(
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

class BrokenGateway extends FakeGateway {
  override fetchOpenApi(): Promise<unknown> {
    return Promise.reject(new Error(`request failed for key ${SECRET}`));
  }
}

const ownTables = (): FakeTable[] => [
  { name: 'bookings', policy: 'own', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
];

/** What the screens read: the audit, its findings and its evidence. */
export interface Snapshot {
  audit: Record<string, unknown>;
  findings: unknown;
  evidence: unknown;
}

async function snapshot(app: INestApplication, id: string): Promise<Snapshot> {
  const http = request(app.getHttpServer());
  return {
    audit: (await getAudit(app, id)).body as Record<string, unknown>,
    findings: (await http.get(`/api/v1/audits/${id}/findings`)).body,
    evidence: (await http.get(`/api/v1/audits/${id}/evidence`)).body,
  };
}

const retestBody = {
  anonKey: PUBLISHABLE,
  serviceKey: SECRET,
  confirmTestProject: true,
};

export type ScenarioName =
  | 'mixed'
  | 'all-blocked'
  | 'prover-failed'
  | 'retest-ok'
  | 'retest-failed'
  | 'report-on'
  | 'cleanup-failed';

export const SCENARIOS: ScenarioName[] = [
  'mixed',
  'all-blocked',
  'prover-failed',
  'retest-ok',
  'retest-failed',
  'report-on',
  'cleanup-failed',
];

/** Runs one scenario to the end and returns what the screens would read. */
export async function runScenario(
  name: ScenarioName,
  agents: AgentsSetup,
): Promise<Snapshot> {
  let call = 0;
  let factory: GatewayFactory;
  let llm: FakeLlm | undefined;
  switch (name) {
    case 'mixed':
      factory = () => new FakeGateway(demoTables());
      break;
    case 'all-blocked':
      factory = () => new FakeGateway(ownTables());
      break;
    case 'prover-failed':
      factory = () => new BrokenGateway(demoTables());
      break;
    case 'retest-ok':
      // the leak on "bookings" is fixed before the re-test
      factory = () =>
        ++call === 1
          ? new FakeGateway(demoTables())
          : new FakeGateway([
              { name: 'bookings', policy: 'own', ownerColumn: 'user_id' },
              { name: 'profiles', policy: 'own', ownerColumn: 'id' },
              { name: 'hotels', policy: 'public-read', ownerColumn: null },
              { name: 'reviews', policy: 'own', ownerColumn: 'user_id' },
            ]);
      break;
    case 'retest-failed':
      factory = () =>
        ++call === 1
          ? new FakeGateway(demoTables())
          : new BrokenGateway(demoTables());
      break;
    case 'report-on':
      llm = new FakeLlm((r) => goodAnswer(r));
      factory = () => new FakeGateway(demoTables());
      break;
    case 'cleanup-failed':
      factory = () => new FakeGateway(demoTables(), { failDeleteUser: true });
      break;
  }
  const app = await buildWith(factory, agents, llm);
  try {
    const first = await post(app, validBody());
    const id = first.body.id as string;
    await waitUntilDone(app, id);
    if (name === 'retest-ok' || name === 'retest-failed') {
      const retest = await post(app, retestBody, `/${id}/retest`);
      if (retest.status !== 202) throw new Error('re-test was not accepted');
      await waitUntilDone(app, id);
    }
    return await snapshot(app, id);
  } finally {
    await app.close();
  }
}

const KEYS_DROPPED = new Set([
  'version',
  'updatedAt',
  'duration',
  'durationMs',
]);

/**
 * Makes a snapshot comparable between runs: random ids, times, uuids and
 * the made-up user emails are replaced by fixed words.
 */
export function normalize(value: unknown): unknown {
  const text = JSON.stringify(value, (key, item: unknown) =>
    KEYS_DROPPED.has(key) ? undefined : item,
  )
    .replace(/aud_[0-9a-f]{16}/g, '<AUD_ID>')
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,
      '<TIME>',
    )
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      '<UUID>',
    )
    .replace(/vca-[0-9a-f]{12}@example\.com/g, '<EMAIL>');
  return JSON.parse(text) as unknown;
}
