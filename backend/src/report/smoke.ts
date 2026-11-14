import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { Finding } from '../prover/types.js';
import { redact } from '../prover/redact.js';
import { createGroqClient } from './groq-client.js';
import { LlmError } from './llm-client.js';
import { MAX_COMPLETION_TOKENS } from './limits.js';
import { buildPrompt, RESPONSE_SCHEMA } from './report-prompt.js';
import { parseChunk } from './report-validate.js';

/**
 * Manual smoke check: ONE small real call to Groq with a made-up finding.
 * Run it yourself: `npm run smoke:groq` (reads backend/.env). It sends only the
 * made-up finding below: no key of a Supabase project, no address.
 *
 * It prints the status, why the answer stopped, the token counts, whether the
 * answer had a reasoning field (its content is never read or printed), the
 * validator's decision and the English text. It never prints the key.
 */
loadDotenv({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

const apiKey = (process.env.GROQ_API_KEY ?? '').trim();
const model = (process.env.GROQ_MODEL ?? '').trim();
const print = (line: string) => console.log(redact(line, [apiKey]));

if (!apiKey || !model) {
  print(
    `Set ${[!apiKey && 'GROQ_API_KEY', !model && 'GROQ_MODEL']
      .filter(Boolean)
      .join(' and ')} in backend/.env first.`,
  );
  process.exit(1);
}

const finding = {
  id: 'fnd_001',
  module: 'data-access-prover',
  table: 'safe_deposit',
  operation: 'SELECT',
  verdict: 'LEAKED',
  severity: 'critical',
  title: 'made-up finding',
  explanation: { en: 'template', ur: 'template' },
  evidence: {
    rowsReturned: 1,
    httpStatus: 200,
    canaryRowId: null,
    reproducer: null,
    operations: [
      {
        operation: 'SELECT',
        actor: 'user_b',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
      {
        operation: 'SELECT',
        actor: 'anon',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'DELETE',
        actor: 'user_b',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
      {
        operation: 'SELECT',
        actor: 'owner',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
    ],
  },
  fix: { status: 'proposed', description: 'd', sql: 'select 1;' },
  retest: { status: 'not_run', lastRunAt: null },
} as unknown as Finding;

// Looks at the raw answer for numbers only. Its text is never printed.
const seen: {
  status?: number;
  usage?: unknown;
  hasReasoningField?: boolean;
  rate: string[];
} = { rate: [] };
const peekingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  seen.status = response.status;
  for (const [name, value] of response.headers) {
    if (/^(x-ratelimit|retry-after)/i.test(name))
      seen.rate.push(`${name}: ${value}`);
  }
  try {
    const body = (await response.clone().json()) as {
      usage?: unknown;
      choices?: { message?: Record<string, unknown> }[];
    };
    seen.usage = body.usage;
    seen.hasReasoningField = body.choices?.[0]?.message
      ? 'reasoning' in body.choices[0].message
      : false;
  } catch {
    /* the client reports an unreadable answer itself */
  }
  return response;
};

const client = createGroqClient({ apiKey, model, fetchImpl: peekingFetch });
const prompt = buildPrompt([finding]);

print(`model: ${model}`);
print(`max_completion_tokens: ${MAX_COMPLETION_TOKENS}`);
try {
  const answer = await client.generate(
    { ...prompt, schema: RESPONSE_SCHEMA },
    AbortSignal.timeout(30_000),
  );
  print(`http status: ${seen.status}`);
  print(`finish_reason: ${answer.finishReason}`);
  print(`usage: ${JSON.stringify(seen.usage)}`);
  print(
    `reasoning field in the answer: ${seen.hasReasoningField ? 'YES (include_reasoning:false did not remove it; its content was not read)' : 'no'}`,
  );
  for (const line of seen.rate) print(line);

  const parsed = parseChunk(answer.content, [finding]);
  const text = parsed.accepted.get(finding.id);
  if (text) {
    print('validator: accepted');
    print(`explanation.en: ${text}`);
  } else {
    print(
      `validator: REJECTED (${parsed.unusable ? 'the answer could not be read' : 'the text did not pass the checks'})`,
    );
    process.exitCode = 2;
  }
} catch (error) {
  print(
    `failed: ${error instanceof LlmError ? `${error.kind}, ${error.message}` : 'unexpected error'}`,
  );
  print(`http status: ${seen.status ?? 'none'}`);
  for (const line of seen.rate) print(line);
  process.exitCode = 1;
}
