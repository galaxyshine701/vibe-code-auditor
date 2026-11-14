import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '../../src/prover/types.js';
import { LlmError } from '../../src/report/llm-client.js';
import type { ReportSetup } from '../../src/report/report-config.js';
import {
  FakeGateway,
  FakeLlm,
  GROQ_SECRET,
  PROJECT_URL,
  PUBLISHABLE,
  SECRET,
  buildApp,
  demoTables,
  findingsOf,
  getAudit,
  goodAnswer,
  groqSetup,
  idsIn,
  post,
  runAudit,
  validBody,
  waitUntilDone,
  type FakeTable,
} from './helpers.js';

const OFF: ReportSetup = { mode: 'off' };

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

/** Everything except the two fields the Report agent may write. */
const withoutAiFields = (findings: Finding[]) =>
  findings.map((f) => {
    const { explanationSource: _source, explanation, evidence, ...rest } = f;
    // the canary row id and the reproducer hold a random id in every run
    const { canaryRowId: _id, reproducer: _curl, ...stableEvidence } = evidence;
    return {
      ...rest,
      evidence: stableEvidence,
      explanationUr: explanation.ur,
    };
  });

const manyTables = (count: number): FakeTable[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `t${String(i).padStart(2, '0')}`,
    policy: 'off' as const,
    ownerColumn: 'user_id',
  }));

describe('Report agent off (the default)', () => {
  it('keeps one module, no explanationSource, and never calls the AI', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildApp(() => new FakeGateway(demoTables()), OFF);
    const id = await runAudit(app);

    const audit = (await getAudit(app, id)).body;
    expect(audit.status).toBe('completed');
    expect(audit.modules).toEqual([
      {
        id: 'data-access-prover',
        name: 'Data Access Prover',
        status: 'completed',
        progress: 100,
      },
    ]);
    for (const f of await findingsOf(app, id)) {
      expect('explanationSource' in f).toBe(false);
    }
    expect(llm.requests).toHaveLength(0);
  });
});

describe('Report agent on, answers fine', () => {
  it('writes explanation.en only, marks it "ai", and shows a second module', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildApp(() => new FakeGateway(demoTables()), groqSetup(llm));
    const id = await runAudit(app);

    const audit = (await getAudit(app, id)).body;
    expect(audit.status).toBe('completed');
    expect(audit.modules).toEqual([
      {
        id: 'data-access-prover',
        name: 'Data Access Prover',
        status: 'completed',
        progress: 100,
      },
      {
        id: 'report-agent',
        name: 'Report agent',
        status: 'completed',
        progress: 100,
      },
    ]);
    const findings = await findingsOf(app, id);
    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.explanationSource).toBe('ai');
      expect(f.explanation.en).toBe(`AI text for ${f.id}.`);
    }
    expect(llm.requests).toHaveLength(1);
  });

  it('changes nothing else: verdict, severity, title, fix, evidence, retest and the Urdu text stay', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()), OFF);
    const offId = await runAudit(app);
    const before = await findingsOf(app, offId);
    await app.close();

    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildApp(() => new FakeGateway(demoTables()), groqSetup(llm));
    const onId = await runAudit(app);
    const after = await findingsOf(app, onId);

    expect(withoutAiFields(after)).toEqual(withoutAiFields(before));
    expect(after.map((f) => f.explanation.ur)).toEqual(
      before.map((f) => f.explanation.ur),
    );
  });
});

describe('Report agent on, but the text cannot be used', () => {
  type Case = [string, () => FakeLlm | null, string?];
  const cases: Case[] = [
    [
      '429',
      () => new FakeLlm(() => new LlmError('rate_limited')),
      'rate limited',
    ],
    ['a timeout', () => new FakeLlm(() => new LlmError('timeout')), 'in time'],
    [
      'not JSON',
      () => new FakeLlm(() => ({ content: 'nope', finishReason: 'stop' })),
      'could not be read',
    ],
    [
      'a banned word',
      () =>
        new FakeLlm((r) =>
          goodAnswer(r, () => 'The app is secure and nobody can read it.'),
        ),
      'did not pass the checks',
    ],
    [
      'a cut-off answer',
      () => new FakeLlm((r) => ({ ...goodAnswer(r), finishReason: 'length' })),
      'cut off',
    ],
    ['a missing key', () => null, 'GROQ_API_KEY is not set.'],
  ];

  it.each(cases)(
    'with %s: the audit completes, the text is the template, the row failed',
    async (_name, makeLlm, expected) => {
      app = await buildApp(
        () => new FakeGateway(demoTables()),
        makeLlm()
          ? groqSetup(makeLlm())
          : groqSetup(null, 'GROQ_API_KEY is not set.'),
      );
      const id = await runAudit(app);

      const audit = (await getAudit(app, id)).body;
      expect(audit.status).toBe('completed');
      expect(audit.error).toBeUndefined();
      const row = audit.modules[1];
      expect(row.id).toBe('report-agent');
      expect(row.status).toBe('failed');
      expect(row.message).toContain(expected);
      expect(row.message).toContain('Template text kept');
      expect(JSON.stringify(audit)).not.toContain(GROQ_SECRET);

      for (const f of await findingsOf(app, id)) {
        expect(f.explanationSource).toBe('template');
        expect(f.explanation.en).not.toMatch(/^AI text/);
      }
    },
  );

  it('does not let a failed Report agent change the findings', async () => {
    app = await buildApp(() => new FakeGateway(demoTables()), OFF);
    const before = await findingsOf(app, await runAudit(app));
    await app.close();

    app = await buildApp(
      () => new FakeGateway(demoTables()),
      groqSetup(new FakeLlm(() => new LlmError('http'))),
    );
    const after = await findingsOf(app, await runAudit(app));
    expect(withoutAiFields(after)).toEqual(withoutAiFields(before));
    expect(after.map((f) => f.explanation.en)).toEqual(
      before.map((f) => f.explanation.en),
    );
  });

  it('never puts a thrown error text into the audit', async () => {
    const llm = new FakeLlm(() => {
      throw new Error(`boom ${GROQ_SECRET} ${SECRET}`);
    });
    app = await buildApp(() => new FakeGateway(demoTables()), groqSetup(llm));
    const id = await runAudit(app);
    const text = JSON.stringify((await getAudit(app, id)).body);
    expect(text).not.toContain(GROQ_SECRET);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('boom');
  });
});

describe('Report agent with many findings', () => {
  it('splits 21 findings into 2 calls of 20 and 1', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildApp(() => new FakeGateway(manyTables(21)), groqSetup(llm));
    const id = await runAudit(app);
    expect(llm.requests.map((r) => idsIn(r).length)).toEqual([20, 1]);
    const findings = await findingsOf(app, id);
    expect(findings.every((f) => f.explanationSource === 'ai')).toBe(true);
    expect((await getAudit(app, id)).body.modules[1].status).toBe('completed');
  });

  it('keeps the AI text of a good chunk when a later chunk fails (row failed, message says how many)', async () => {
    const llm = new FakeLlm((r, call) =>
      call === 1 ? goodAnswer(r) : new LlmError('http'),
    );
    app = await buildApp(() => new FakeGateway(manyTables(21)), groqSetup(llm));
    const id = await runAudit(app);

    const audit = (await getAudit(app, id)).body;
    expect(audit.status).toBe('completed');
    expect(audit.modules[1].status).toBe('failed');
    expect(audit.modules[1].message).toContain('1 of 21');
    const sources = (await findingsOf(app, id)).map((f) => f.explanationSource);
    expect(sources.filter((s) => s === 'ai')).toHaveLength(20);
    expect(sources.filter((s) => s === 'template')).toHaveLength(1);
  });

  it('stops asking after a 429 and counts the rest as not used', async () => {
    const llm = new FakeLlm(() => new LlmError('rate_limited'));
    app = await buildApp(() => new FakeGateway(manyTables(41)), groqSetup(llm));
    const id = await runAudit(app);
    expect(llm.requests).toHaveLength(1);
    expect((await getAudit(app, id)).body.modules[1].message).toContain(
      '41 of 41',
    );
  });
});

describe('what is sent to the AI', () => {
  it('has no key, address, canary id, reproducer or user id', async () => {
    const gateway = new FakeGateway(demoTables());
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildApp(() => gateway, groqSetup(llm));
    const id = await runAudit(app);
    const findings = await findingsOf(app, id);

    const sent = llm.requests.map((r) => r.system + r.user).join('\n');
    expect(sent).toContain('bookings'); // table names are sent
    const forbidden = [
      PUBLISHABLE,
      SECRET,
      GROQ_SECRET,
      PROJECT_URL,
      'supabase.co',
      ...findings.flatMap((f) => [
        f.evidence.canaryRowId,
        f.evidence.reproducer,
      ]),
      ...gateway.users.keys(),
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    expect(forbidden.length).toBeGreaterThan(5);
    for (const value of forbidden) expect(sent).not.toContain(value);
  });
});

describe('progress while the Report agent works', () => {
  it('shows the Prover row done and the Report row running, audit still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = new FakeLlm(async (r) => {
      await gate;
      return goodAnswer(r);
    });
    app = await buildApp(() => new FakeGateway(demoTables()), groqSetup(llm));
    const started = await post(app, validBody());
    const id = started.body.id as string;

    let mid = (await getAudit(app, id)).body;
    for (let i = 0; i < 400 && mid.modules[1]?.status !== 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      mid = (await getAudit(app, id)).body;
    }
    expect(mid.status).toBe('running');
    expect(mid.modules[0]).toMatchObject({
      status: 'completed',
      progress: 100,
    });
    expect(mid.modules[1]).toMatchObject({ status: 'running', progress: 0 });

    release();
    const done = await waitUntilDone(app, id);
    expect(done.body.modules[1]).toMatchObject({
      status: 'completed',
      progress: 100,
    });
  });
});

describe('Re-test with the Report agent on', () => {
  it('runs the Report agent again and keeps the audit completed when it fails', async () => {
    let fail = false;
    const llm = new FakeLlm((r) =>
      fail ? new LlmError('http') : goodAnswer(r),
    );
    app = await buildApp(() => new FakeGateway(demoTables()), groqSetup(llm));
    const id = await runAudit(app);

    fail = true;
    const retest = await post(
      app,
      { anonKey: PUBLISHABLE, serviceKey: SECRET, confirmTestProject: true },
      `/${id}/retest`,
    );
    expect(retest.status).toBe(202);
    const done = await waitUntilDone(app, id);

    expect(done.body.status).toBe('completed');
    expect(done.body.lastRetest.status).toBe('completed');
    expect(done.body.modules[1].status).toBe('failed');
    expect(llm.requests).toHaveLength(2);
    const sources = (await findingsOf(app, id)).map((f) => f.explanationSource);
    expect(sources.every((s) => s === 'template')).toBe(true);
  });
});

describe('the Prover fails, so the Report agent never runs', () => {
  class BrokenGateway extends FakeGateway {
    override fetchOpenApi(): Promise<unknown> {
      return Promise.reject(new Error(`request failed for key ${SECRET}`));
    }
  }

  it('Re-test: the report-agent row is "failed" with "Not run", not "queued"', async () => {
    let call = 0;
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildApp(
      () =>
        ++call === 1
          ? new FakeGateway(demoTables())
          : new BrokenGateway(demoTables()),
      groqSetup(llm),
    );
    const id = await runAudit(app);
    const requestsBefore = llm.requests.length;

    const retest = await post(
      app,
      { anonKey: PUBLISHABLE, serviceKey: SECRET, confirmTestProject: true },
      `/${id}/retest`,
    );
    expect(retest.status).toBe(202);
    const done = await waitUntilDone(app, id);

    expect(done.body.status).toBe('completed');
    expect(done.body.lastRetest.status).toBe('failed');
    expect(done.body.modules).toHaveLength(2);
    expect(done.body.modules[1]).toEqual({
      id: 'report-agent',
      name: 'Report agent',
      status: 'failed',
      progress: 0,
      message: 'Not run: the Re-test did not finish.',
    });
    expect(llm.requests).toHaveLength(requestsBefore); // the AI was not called
    expect(JSON.stringify(done.body)).not.toContain(SECRET);
    // the findings from before are untouched
    const sources = (await findingsOf(app, id)).map((f) => f.explanationSource);
    expect(sources.every((s) => s === 'ai')).toBe(true);
  });

  it('first audit: the row is "failed" with "Not run: the audit did not finish."', async () => {
    const llm = new FakeLlm((r) => goodAnswer(r));
    app = await buildApp(() => new BrokenGateway(demoTables()), groqSetup(llm));
    const id = await runAudit(app);

    const audit = (await getAudit(app, id)).body;
    expect(audit.status).toBe('failed');
    expect(audit.modules[0].status).toBe('failed');
    expect(audit.modules[1]).toMatchObject({
      id: 'report-agent',
      status: 'failed',
      message: 'Not run: the audit did not finish.',
    });
    expect(llm.requests).toHaveLength(0);
  });

  it('with the Report agent off, a failed Re-test still shows one module', async () => {
    let call = 0;
    app = await buildApp(
      () =>
        ++call === 1
          ? new FakeGateway(demoTables())
          : new BrokenGateway(demoTables()),
      OFF,
    );
    const id = await runAudit(app);
    await post(
      app,
      { anonKey: PUBLISHABLE, serviceKey: SECRET, confirmTestProject: true },
      `/${id}/retest`,
    );
    const done = await waitUntilDone(app, id);
    expect(done.body.lastRetest.status).toBe('failed');
    expect(done.body.modules).toHaveLength(1);
  });
});

describe('logging', () => {
  it('never writes a request or an answer of the AI to the logs', async () => {
    const SENTINEL = 'SENTINEL-AI-TEXT-77';
    const llm = new FakeLlm((r) =>
      goodAnswer(r, () => `${SENTINEL} reads fine.`),
    );
    const out: string[] = [];
    const grab = (chunk: unknown) => {
      out.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(grab as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(grab as never);
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        out.push(args.map(String).join(' '));
      });
    }

    app = await buildApp(() => new FakeGateway(demoTables()), groqSetup(llm), {
      logs: true,
    });
    await runAudit(app);
    const failing = new FakeLlm(() => {
      throw new Error(`secret detail ${SENTINEL}`);
    });
    await app.close();
    app = await buildApp(
      () => new FakeGateway(demoTables()),
      groqSetup(failing),
      { logs: true },
    );
    await runAudit(app);

    const logs = out.join('\n');
    expect(logs).toContain('started'); // logging was really on
    expect(logs).not.toContain(SENTINEL);
    expect(logs).not.toContain('bookings'); // table names are in the request body
    expect(logs).not.toContain(GROQ_SECRET);
  });
});
