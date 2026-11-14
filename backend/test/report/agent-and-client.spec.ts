import { describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../../src/agents/prover-agent.js';
import type { Finding } from '../../src/prover/types.js';
import { createGroqClient, GROQ_URL } from '../../src/report/groq-client.js';
import { LlmError } from '../../src/report/llm-client.js';
import { MAX_COMPLETION_TOKENS } from '../../src/report/limits.js';
import { createReportAgent } from '../../src/report/report-agent.js';
import { resolveReportSetup } from '../../src/report/report-config.js';
import { RESPONSE_SCHEMA } from '../../src/report/report-prompt.js';

const REQUEST = { system: 's', user: 'u', schema: RESPONSE_SCHEMA };
const KEY = 'GROQ-FAKE-KEY-VALUE-5d4c3b';
const SENTINEL = 'REASONING-SENTINEL-4242';

function reply(body: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('Groq request', () => {
  it('sends the documented format', async () => {
    const fetchImpl = reply({
      choices: [
        { message: { content: '{"items":[]}' }, finish_reason: 'stop' },
      ],
    });
    const client = createGroqClient({
      apiKey: KEY,
      model: 'openai/gpt-oss-20b',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.generate(REQUEST, new AbortController().signal);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(GROQ_URL);
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('openai/gpt-oss-20b');
    expect(body.reasoning_effort).toBe('low');
    expect(body.include_reasoning).toBe(false);
    expect('reasoning_format' in body).toBe(false);
    expect('max_tokens' in body).toBe(false);
    expect('stream' in body).toBe(false);
    expect(body.max_completion_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(body.max_completion_tokens).toBe(6000);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'report_explanations',
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    });
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
  });

  it('returns only the final message text and the finish reason, never the reasoning', async () => {
    const fetchImpl = reply({
      choices: [
        {
          message: {
            content: '{"items":[]}',
            reasoning: SENTINEL,
            reasoning_content: SENTINEL,
          },
          finish_reason: 'stop',
          reasoning: SENTINEL,
        },
      ],
      reasoning: SENTINEL,
    });
    const client = createGroqClient({
      apiKey: KEY,
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const answer = await client.generate(REQUEST, new AbortController().signal);
    expect(answer).toEqual({ content: '{"items":[]}', finishReason: 'stop' });
    expect(JSON.stringify(answer)).not.toContain(SENTINEL);
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'auth'],
    [403, 'auth'],
    [500, 'http'],
    [400, 'http'],
  ])('maps HTTP %s to %s with a fixed message', async (status, kind) => {
    const fetchImpl = reply(
      { error: { message: `leaks ${KEY} ${SENTINEL}` } },
      status,
    );
    const client = createGroqClient({
      apiKey: KEY,
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const error = await client
      .generate(REQUEST, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe(kind);
    expect((error as LlmError).message).not.toContain(KEY);
    expect((error as LlmError).message).not.toContain(SENTINEL);
  });

  it('treats an empty or odd answer as empty, a thrown fetch as network, an abort as timeout', async () => {
    const make = (fetchImpl: unknown) =>
      createGroqClient({
        apiKey: KEY,
        model: 'm',
        fetchImpl: fetchImpl as typeof fetch,
      });
    const kindOf = async (client: ReturnType<typeof make>) =>
      (
        (await client
          .generate(REQUEST, new AbortController().signal)
          .catch((e: unknown) => e)) as LlmError
      ).kind;

    expect(await kindOf(make(reply({ choices: [] })))).toBe('empty');
    expect(
      await kindOf(make(reply({ choices: [{ message: { content: ' ' } }] }))),
    ).toBe('empty');
    expect(
      await kindOf(
        make(async () => {
          throw new Error(`down ${KEY}`);
        }),
      ),
    ).toBe('network');
    expect(
      await kindOf(
        make(async () => {
          throw new DOMException('aborted', 'AbortError');
        }),
      ),
    ).toBe('timeout');
  });
});

describe('createReportAgent', () => {
  const finding = (id: string, table: string): Finding =>
    ({
      id,
      module: 'data-access-prover',
      table,
      operation: 'SELECT',
      verdict: 'LEAKED',
      severity: 'critical',
      title: 't',
      explanation: { en: 'template', ur: 'urdu' },
      evidence: {
        rowsReturned: 1,
        httpStatus: 200,
        canaryRowId: null,
        reproducer: null,
        operations: [],
      },
      fix: null,
      retest: { status: 'not_run', lastRunAt: null },
    }) as Finding;

  const contextOf = (n: number): RunContext => ({
    prover: {
      findings: Array.from({ length: n }, (_, i) => finding(`f${i}`, `t${i}`)),
      cleanup: 'ok',
    },
  });

  it('gives up on a call that never answers, after the call timeout', async () => {
    const agent = createReportAgent({
      llm: { generate: () => new Promise(() => {}) },
      callTimeoutMs: 20,
    });
    const context = contextOf(2);
    await expect(agent.run(context, () => {})).rejects.toThrow(
      'did not answer in time',
    );
    expect(
      context.prover!.findings.every((f) => f.explanationSource === 'template'),
    ).toBe(true);
  });

  it('aborts the request when the call times out', async () => {
    let aborted = false;
    const agent = createReportAgent({
      llm: {
        generate: (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('x'));
            });
          }),
      },
      callTimeoutMs: 20,
    });
    await agent.run(contextOf(1), () => {}).catch(() => {});
    expect(aborted).toBe(true);
  });

  it('skips the rest when the time budget is used up', async () => {
    let clock = 0;
    const llm = {
      generate: vi.fn(async (request: { user: string }) => {
        clock += 100;
        const ids = (
          JSON.parse(request.user) as { findings: { id: string }[] }
        ).findings.map((f) => f.id);
        return {
          content: JSON.stringify({
            items: ids.map((id) => ({ id, explanation: 'Fine text.' })),
          }),
          finishReason: 'stop',
        };
      }),
    };
    const agent = createReportAgent({
      llm,
      budgetMs: 50,
      now: () => clock,
    });
    const context = contextOf(41);
    await expect(agent.run(context, () => {})).rejects.toThrow('21 of 41');
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('reports progress per chunk', async () => {
    const seen: number[] = [];
    const agent = createReportAgent({
      llm: {
        generate: async (request) => ({
          content: JSON.stringify({
            items: (
              JSON.parse(request.user) as { findings: { id: string }[] }
            ).findings.map((f) => ({ id: f.id, explanation: 'Fine text.' })),
          }),
          finishReason: 'stop',
        }),
      },
    });
    await agent.run(contextOf(41), (p) => seen.push(p));
    expect(seen).toEqual([33, 67, 100]);
  });
});

describe('resolveReportSetup', () => {
  it('is off by default and for "off"', () => {
    expect(resolveReportSetup({}).setup).toEqual({ mode: 'off' });
    expect(resolveReportSetup({ REPORT_AGENT: 'off' }).setup).toEqual({
      mode: 'off',
    });
    expect(resolveReportSetup({}).warnings).toEqual([]);
  });

  it('is off for an unknown value, with a warning', () => {
    const { setup, warnings } = resolveReportSetup({ REPORT_AGENT: 'yes' });
    expect(setup.mode).toBe('off');
    expect(warnings).toHaveLength(1);
  });

  it('is on for "groq" with a key and a model', () => {
    const { setup, warnings } = resolveReportSetup({
      REPORT_AGENT: 'groq',
      GROQ_API_KEY: KEY,
      GROQ_MODEL: 'openai/gpt-oss-20b',
    });
    expect(setup.mode).toBe('groq');
    expect(setup.mode === 'groq' && setup.llm).toBeTruthy();
    expect(warnings).toEqual([]);
  });

  it('names a missing variable and never prints a value', () => {
    const noKey = resolveReportSetup({
      REPORT_AGENT: 'groq',
      GROQ_MODEL: 'openai/gpt-oss-20b',
    });
    expect(noKey.warnings[0]).toContain('GROQ_API_KEY is not set');
    const noModel = resolveReportSetup({
      REPORT_AGENT: 'groq',
      GROQ_API_KEY: KEY,
    });
    expect(noModel.warnings[0]).toContain('GROQ_MODEL is not set');
    expect(JSON.stringify(noModel.warnings)).not.toContain(KEY);
    const neither = resolveReportSetup({ REPORT_AGENT: 'groq' });
    expect(neither.warnings[0]).toContain(
      'GROQ_API_KEY and GROQ_MODEL are not set',
    );
    expect(neither.setup.mode === 'groq' && neither.setup.llm).toBeNull();
  });

  it('is off in the test environment, whatever the shell has', () => {
    expect(process.env.REPORT_AGENT).toBe('off');
    expect(process.env.GROQ_API_KEY).toBe('');
  });
});
