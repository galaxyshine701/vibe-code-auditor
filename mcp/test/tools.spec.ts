import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE,
  connect,
  isError,
  makeConfig,
  makeFetch,
  textOf,
  type Call,
  type FakeReply,
} from './helpers.js';

const ID = 'aud_0123456789abcdef';
const TOOLS = [
  'get_audit',
  'get_certificate',
  'get_report',
  'request_retest',
  'start_audit',
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(
  reply: (call: Call) => FakeReply | Error,
  config = makeConfig(),
  sleep?: (ms: number) => Promise<void>,
) {
  const fake = makeFetch(reply);
  const connected = await connect(config, fake.fn, sleep);
  close = connected.close;
  return { client: connected.client, calls: fake.calls };
}

const audit = (status: string) => ({
  id: ID,
  status,
  createdAt: '2026-11-14T10:00:00.000Z',
  target: { label: 'x', projectUrl: FAKE.supabaseUrl },
  summary: { leaked: 1, blocked: 0, inconclusive: 0 },
  modules: [
    {
      id: 'data-access-prover',
      name: 'Data Access Prover',
      status,
      progress: 40,
    },
  ],
  cleanup: null,
  lastRetest: null,
});

describe('tool list and schemas', () => {
  it('offers exactly the five tools', async () => {
    const { client } = await setup(() => ({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  });

  it('has no field for a key, an address, a code or a confirmation, and no language', async () => {
    const { client } = await setup(() => ({}));
    const { tools } = await client.listTools();
    const allowed = new Set(['id', 'label', 'waitSeconds']);
    for (const tool of tools) {
      const props = Object.keys(tool.inputSchema.properties ?? {});
      for (const name of props) expect(allowed.has(name)).toBe(true);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it.each([
    ['start_audit', { projectUrl: 'https://x.supabase.co' }],
    ['start_audit', { anonKey: 'k' }],
    ['start_audit', { serviceKey: 'k' }],
    ['start_audit', { confirmTestProject: true }],
    ['request_retest', { id: ID, accessCode: 'c' }],
    ['request_retest', { id: ID, confirmTestProject: true }],
    ['get_report', { id: ID, language: 'ur' }],
    ['get_audit', { id: ID, apiUrl: 'https://evil.test' }],
  ])(
    'rejects %s with an extra field %j and sends nothing',
    async (name, args) => {
      const { client, calls } = await setup(() => ({}));
      let rejected = false;
      try {
        const result = await client.callTool({ name, arguments: args });
        rejected = isError(result);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      expect(calls).toEqual([]);
    },
  );

  it('rejects an id that is not an audit id', async () => {
    const { client, calls } = await setup(() => ({}));
    const result = await client
      .callTool({ name: 'get_audit', arguments: { id: '../health' } })
      .catch(() => ({ isError: true }));
    expect(isError(result)).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('start_audit and request_retest', () => {
  it('sends the keys and the confirmation from the settings, with the access code header', async () => {
    const { client, calls } = await setup(() => ({
      status: 202,
      body: { id: ID, status: 'running' },
    }));
    const result = await client.callTool({
      name: 'start_audit',
      arguments: { label: 'demo' },
    });
    expect(isError(result)).toBe(false);
    expect(JSON.parse(textOf(result))).toEqual({ id: ID, status: 'running' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.example.test/api/v1/audits');
    expect(calls[0].headers['x-access-code']).toBe(FAKE.accessCode);
    expect(calls[0].body).toEqual({
      label: 'demo',
      projectUrl: FAKE.supabaseUrl,
      anonKey: FAKE.publishableKey,
      serviceKey: FAKE.secretKey,
      confirmTestProject: true,
    });
  });

  it('request_retest sends keys and confirmation but no address', async () => {
    const { client, calls } = await setup(() => ({
      status: 202,
      body: { id: ID, status: 'running' },
    }));
    await client.callTool({ name: 'request_retest', arguments: { id: ID } });
    expect(calls[0].url).toBe(
      `https://api.example.test/api/v1/audits/${ID}/retest`,
    );
    expect(calls[0].body).toEqual({
      anonKey: FAKE.publishableKey,
      serviceKey: FAKE.secretKey,
      confirmTestProject: true,
    });
  });

  it.each([
    ['start_audit', {}],
    ['request_retest', { id: ID }],
  ])(
    '%s refuses without VCA_CONFIRM_TEST_PROJECT=yes and does not call the server',
    async (name, args) => {
      const { client, calls } = await setup(
        () => ({ body: {} }),
        makeConfig({ confirmTestProject: false }),
      );
      const result = await client.callTool({ name, arguments: args });
      expect(isError(result)).toBe(true);
      expect(textOf(result)).toContain('VCA_CONFIRM_TEST_PROJECT');
      expect(calls).toEqual([]);
    },
  );
});

describe('get_audit', () => {
  it('returns the status without the address', async () => {
    const { client } = await setup(() => ({ body: audit('completed') }));
    const result = await client.callTool({
      name: 'get_audit',
      arguments: { id: ID },
    });
    const out = JSON.parse(textOf(result));
    expect(out.status).toBe('completed');
    expect(out.summary.leaked).toBe(1);
    expect(out.target).toBeUndefined();
  });

  it('waits while the audit runs, then returns', async () => {
    let n = 0;
    const slept: number[] = [];
    const { client, calls } = await setup(
      () => ({ body: audit(++n < 3 ? 'running' : 'completed') }),
      makeConfig(),
      async (ms) => {
        slept.push(ms);
      },
    );
    const result = await client.callTool({
      name: 'get_audit',
      arguments: { id: ID, waitSeconds: 30 },
    });
    expect(JSON.parse(textOf(result)).status).toBe('completed');
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([2000, 2000]);
  });

  it('stops waiting after waitSeconds', async () => {
    const { client, calls } = await setup(
      () => ({ body: audit('running') }),
      makeConfig(),
    );
    const result = await client.callTool({
      name: 'get_audit',
      arguments: { id: ID, waitSeconds: 4 },
    });
    expect(JSON.parse(textOf(result)).status).toBe('running');
    expect(calls).toHaveLength(3);
  });
});

describe('get_report', () => {
  const finding = {
    id: 'f_1',
    module: 'data-access-prover',
    table: 'bookings',
    operation: 'SELECT',
    verdict: 'LEAKED',
    severity: 'critical',
    title: 'Any logged-in user can read bookings',
    explanation: { en: 'English text.', ur: 'Urdu text.' },
    evidence: {
      rowsReturned: 1,
      httpStatus: 200,
      canaryRowId: 'row-1',
      reproducer: 'curl https://fakeproject.supabase.co/rest/v1/bookings',
    },
    fix: {
      status: 'proposed',
      description: 'Turn on RLS.',
      sql: 'alter table x;',
    },
    retest: { status: 'not_run', lastRunAt: null, previousVerdict: null },
  };

  it('returns English only, with coverage, and leaves out evidence details', async () => {
    const { client } = await setup((call) =>
      call.url.endsWith('/findings')
        ? { body: { findings: [finding] } }
        : { body: audit('completed') },
    );
    const result = await client.callTool({
      name: 'get_report',
      arguments: { id: ID },
    });
    const text = textOf(result);
    const out = JSON.parse(text);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].explanation).toBe('English text.');
    expect(out.findings[0].fix.sql).toBe('alter table x;');
    expect(out.coverage.statement).toContain('table data access only');
    expect(text).not.toContain('Urdu text.');
    expect(text).not.toContain('canaryRowId');
    expect(text).not.toContain('reproducer');
    expect(text).not.toContain(FAKE.supabaseUrl);
  });
});

describe('get_certificate', () => {
  it('returns the record when eligible', async () => {
    const { client } = await setup(() => ({
      body: {
        auditId: ID,
        result: 'NO_LEAK_FOUND_BY_THESE_CHECKS',
        recordHash: 'abc',
      },
    }));
    const out = JSON.parse(
      textOf(
        await client.callTool({
          name: 'get_certificate',
          arguments: { id: ID },
        }),
      ),
    );
    expect(out.eligible).toBe(true);
    expect(out.result).toBe('NO_LEAK_FOUND_BY_THESE_CHECKS');
  });

  it('says why when NOT_ELIGIBLE, without an error flag', async () => {
    const { client } = await setup(() => ({
      status: 409,
      body: {
        error: {
          code: 'NOT_ELIGIBLE',
          message:
            'A leak was found and is still there. Fix it, then run a re-test.',
        },
      },
    }));
    const result = await client.callTool({
      name: 'get_certificate',
      arguments: { id: ID },
    });
    expect(isError(result)).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.eligible).toBe(false);
    expect(out.message).toContain('A leak was found');
  });
});

describe('errors', () => {
  const cases: [string, FakeReply | Error, string][] = [
    [
      '401',
      { status: 401, body: { error: { code: 'UNAUTHORIZED' } } },
      'access code',
    ],
    [
      '404',
      { status: 404, body: { error: { code: 'NOT_FOUND' } } },
      'NOT_FOUND',
    ],
    [
      '409 in progress',
      {
        status: 409,
        body: {
          error: {
            code: 'AUDIT_IN_PROGRESS',
            message: 'Another audit is still running.',
          },
        },
      },
      'AUDIT_IN_PROGRESS',
    ],
    [
      '429',
      { status: 429, headers: { 'retry-after': '12' }, body: {} },
      'Try again in 12 seconds',
    ],
    ['500', { status: 500, body: {} }, 'HTTP 500'],
    [
      'network',
      new Error(`connect failed to ${FAKE.supabaseUrl}`),
      'Cannot reach',
    ],
  ];

  it.each(cases)(
    'maps %s to a short message',
    async (_name, reply, expected) => {
      const { client } = await setup(() => reply);
      const result = await client.callTool({
        name: 'get_audit',
        arguments: { id: ID },
      });
      expect(isError(result)).toBe(true);
      expect(textOf(result)).toContain(expected);
    },
  );
});

describe('redaction', () => {
  it('hides every secret the server echoes back, in errors and in results', async () => {
    const echo = `${FAKE.secretKey} ${FAKE.publishableKey} ${FAKE.accessCode} ${FAKE.supabaseUrl}`;
    const { client } = await setup((call) =>
      call.url.endsWith('/findings')
        ? {
            body: {
              findings: [
                {
                  id: 'f_1',
                  table: 'bookings',
                  verdict: 'LEAKED',
                  severity: 'critical',
                  title: echo,
                  explanation: { en: echo, ur: '' },
                  fix: { status: 'proposed', description: echo, sql: echo },
                  retest: {},
                },
              ],
            },
          }
        : { body: audit('completed') },
    );
    const report = textOf(
      await client.callTool({ name: 'get_report', arguments: { id: ID } }),
    );
    expect(report).toContain('[REDACTED]');
    for (const secret of Object.values(FAKE))
      expect(report).not.toContain(secret);

    const failing = await setup(() => ({
      status: 400,
      body: { error: { code: 'INVALID_INPUT', message: `bad ${echo}` } },
    }));
    const error = textOf(
      await failing.client.callTool({ name: 'start_audit', arguments: {} }),
    );
    expect(error).toContain('[REDACTED]');
    for (const secret of Object.values(FAKE))
      expect(error).not.toContain(secret);
  });
});
