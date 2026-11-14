import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { Finding } from '../prover/types.js';
import { redact } from '../prover/redact.js';
import { createGroqClient } from './groq-client.js';
import { LlmError } from './llm-client.js';
import { MAX_COMPLETION_TOKENS } from './limits.js';
import { buildPrompt, RESPONSE_SCHEMA } from './report-prompt.js';
import {
  checkExplanation,
  checkSentence,
  composeExplanation,
  parseChunk,
  sanitizeExplanation,
  wordsOutsideVocabulary,
} from './report-validate.js';

/**
 * Manual smoke check with REAL calls to Groq and made-up findings only.
 * Run it yourself:   npm run smoke:groq -- --runs 3
 *
 *  - Each run sends the same three made-up findings (LEAKED, BLOCKED and
 *    INCONCLUSIVE) in one call and prints, per finding, the characters that
 *    are not plain ASCII (code points, found BEFORE the text is cleaned), the
 *    sentence the AI wrote, the final text the program composed from it, and
 *    the validator's decision with its reason.
 *  - Between runs it waits 20 seconds (the free tier allows 8000 tokens a
 *    minute).
 *  - At the end ONE call with 20 made-up findings, only to read the token
 *    counts (prompt_tokens and completion_tokens).
 *
 * Nothing but the made-up findings is sent: no key of a Supabase project, no
 * address. The key of Groq is never printed.
 */
loadDotenv({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

const apiKey = (process.env.GROQ_API_KEY ?? '').trim();
const model = (process.env.GROQ_MODEL ?? '').trim();
const print = (line = '') => console.log(redact(line, [apiKey]));

const WAIT_MS = 20_000;
const runsArg = process.argv.indexOf('--runs');
const runs =
  runsArg >= 0 ? Number.parseInt(process.argv[runsArg + 1] ?? '', 10) : 3;

if (!apiKey || !model) {
  print(
    `Set ${[!apiKey && 'GROQ_API_KEY', !model && 'GROQ_MODEL']
      .filter(Boolean)
      .join(' and ')} in backend/.env first.`,
  );
  process.exit(1);
}
if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
  print('Use --runs N with N from 1 to 10, for example: --runs 3');
  process.exit(1);
}

const op = (
  operation: string,
  actor: string,
  allowed: boolean | null,
  rowsReturned: number | null,
) => ({ operation, actor, allowed, httpStatus: 200, rowsReturned });

const made = (
  id: string,
  table: string,
  verdict: Finding['verdict'],
  operations: ReturnType<typeof op>[],
) =>
  ({
    id,
    module: 'data-access-prover',
    table,
    operation: 'SELECT',
    verdict,
    severity: verdict === 'LEAKED' ? 'critical' : 'info',
    title: 'made-up finding',
    explanation: { en: 'template', ur: 'template' },
    evidence: {
      rowsReturned: null,
      httpStatus: null,
      canaryRowId: null,
      reproducer: null,
      operations,
    },
    fix: null,
    retest: { status: 'not_run', lastRunAt: null },
  }) as unknown as Finding;

const OPERATIONS: Record<Finding['verdict'], ReturnType<typeof op>[]> = {
  LEAKED: [
    op('SELECT', 'user_b', true, 1),
    op('SELECT', 'anon', false, 0),
    op('DELETE', 'user_b', true, 1),
    op('SELECT', 'owner', true, 1),
  ],
  BLOCKED: [
    op('SELECT', 'user_b', false, 0),
    op('SELECT', 'anon', false, 0),
    op('DELETE', 'user_b', false, 0),
    op('SELECT', 'owner', true, 1),
  ],
  INCONCLUSIVE: [
    op('SELECT', 'user_b', false, 0),
    op('SELECT', 'anon', false, 0),
    op('SELECT', 'owner', false, 0),
  ],
};

const mixed: Finding[] = [
  made('fnd_001', 'safe_deposit', 'LEAKED', OPERATIONS.LEAKED),
  made('fnd_002', 'bookings', 'BLOCKED', OPERATIONS.BLOCKED),
  made('fnd_003', 'hotels', 'INCONCLUSIVE', OPERATIONS.INCONCLUSIVE),
];

/** 20 made-up findings with the three verdicts in turn. */
const twenty: Finding[] = Array.from({ length: 20 }, (_, i) => {
  const verdict = (['LEAKED', 'BLOCKED', 'INCONCLUSIVE'] as const)[i % 3];
  const name = `table_${String(i + 1).padStart(2, '0')}`;
  return made(
    `fnd_${String(i + 1).padStart(3, '0')}`,
    name,
    verdict,
    OPERATIONS[verdict],
  );
});

// Looks at the raw answer for numbers only. Its text is never printed.
interface Seen {
  status?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  hasReasoningField?: boolean;
  rate: string[];
  /** from a "rate limit" error: only the three numbers, never the message */
  limit?: string;
}
let seen: Seen = { rate: [] };
const peekingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  seen.status = response.status;
  for (const [name, value] of response.headers) {
    if (/^(x-ratelimit|retry-after)/i.test(name)) {
      seen.rate.push(`${name}: ${value}`);
    }
  }
  try {
    const body = (await response.clone().json()) as {
      usage?: Seen['usage'];
      choices?: { message?: Record<string, unknown> }[];
      error?: { message?: unknown };
    };
    seen.usage = body.usage;
    seen.hasReasoningField = body.choices?.[0]?.message
      ? 'reasoning' in body.choices[0].message
      : undefined;
    const message =
      typeof body.error?.message === 'string' ? body.error.message : '';
    const numbers = /Limit (\d+), Used (\d+), Requested (\d+)/.exec(message);
    if (numbers) {
      seen.limit = `Limit ${numbers[1]}, Used ${numbers[2]}, Requested ${numbers[3]}`;
    }
  } catch {
    /* the client reports an unreadable answer itself */
  }
  return response;
};

/** Every character that is not plain ASCII, as a code point, before cleaning. */
function oddCharacters(text: string): string {
  const odd = [...text]
    .filter((c) => {
      const code = c.codePointAt(0)!;
      return code < 0x20 || code > 0x7e;
    })
    .map(
      (c) =>
        `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
    );
  return odd.length ? [...new Set(odd)].join(' ') : 'none';
}

const client = createGroqClient({ apiKey, model, fetchImpl: peekingFetch });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
let anyRejected = false;

/** One real call. Returns how many findings were accepted, or null if the call failed. */
async function call(label: string, findings: Finding[], showEach: boolean) {
  seen = { rate: [] };
  const prompt = buildPrompt(findings);
  print(`=== ${label} ===`);
  try {
    const answer = await client.generate(
      { ...prompt, schema: RESPONSE_SCHEMA },
      AbortSignal.timeout(60_000),
    );
    print(
      `http status: ${seen.status}   finish_reason: ${answer.finishReason}`,
    );
    print(
      `usage: prompt_tokens=${seen.usage?.prompt_tokens}, completion_tokens=${seen.usage?.completion_tokens}, total_tokens=${seen.usage?.total_tokens}`,
    );
    print(
      `reasoning field in the answer: ${seen.hasReasoningField ? 'YES (its content was not read)' : 'no'}`,
    );
    for (const line of seen.rate) print(line);

    const raw = new Map<string, string>();
    try {
      const data = JSON.parse(answer.content) as {
        items?: { id?: unknown; sentence?: unknown }[];
      };
      for (const item of data.items ?? []) {
        if (typeof item.id === 'string' && typeof item.sentence === 'string') {
          raw.set(item.id, item.sentence);
        }
      }
    } catch {
      /* parseChunk below says the answer could not be read */
    }

    const parsed = parseChunk(answer.content, findings);
    const tables = findings.map((f) => f.table);
    for (const finding of findings) {
      const sentence = raw.get(finding.id);
      const kept = parsed.accepted.get(finding.id);
      if (kept === undefined) anyRejected = true;
      if (!showEach && kept !== undefined) continue;
      print('');
      print(`${finding.id} ${finding.verdict} (${finding.table})`);
      if (sentence === undefined) {
        print('  the AI wrote no sentence for this finding');
      } else {
        print(`  sentence from the AI: ${sentence}`);
        print(
          `  characters that are not plain ASCII: ${oddCharacters(sentence)}`,
        );
      }
      if (kept !== undefined) {
        print('  validator: accepted');
        print(`  final composed text: ${kept}`);
      } else {
        const clean =
          sentence === undefined ? null : sanitizeExplanation(sentence);
        let reason = 'no sentence';
        if (sentence !== undefined && clean === null) reason = 'characters';
        else if (clean !== null) {
          const body = clean.replace(/[.!?\s]+$/, '');
          reason =
            checkSentence(body, finding, tables) ??
            (composeExplanation(clean, finding) === null
              ? 'sentences'
              : (checkExplanation(
                  composeExplanation(clean, finding)!,
                  finding,
                  tables,
                ) ?? 'unknown'));
          if (reason === 'vocabulary') {
            const words = wordsOutsideVocabulary(body, finding, tables);
            if (words.length) reason += `: ${words.join(', ')}`;
          }
        }
        print(`  validator: REJECTED (${reason})`);
      }
    }
    print('');
    print(`accepted ${parsed.accepted.size} of ${findings.length}`);
    return parsed.accepted.size;
  } catch (error) {
    print(
      `failed: ${error instanceof LlmError ? `${error.kind}, ${error.message}` : 'unexpected error'}`,
    );
    print(`http status: ${seen.status ?? 'none'}`);
    if (seen.limit) print(`rate limit numbers: ${seen.limit}`);
    for (const line of seen.rate) print(line);
    anyRejected = true;
    return null;
  }
}

print(`model: ${model}`);
print(`max_completion_tokens: ${MAX_COMPLETION_TOKENS}`);
print(`runs: ${runs}, then one call with 20 findings (tokens only)`);
print('');

const summary: string[] = [];
for (let i = 1; i <= runs; i++) {
  const accepted = await call(`run ${i} of ${runs} (3 findings)`, mixed, true);
  summary.push(
    `run ${i}: ${accepted === null ? 'call failed' : `${accepted} of 3 accepted`}`,
  );
  print('');
  print(`waiting ${WAIT_MS / 1000} seconds (token limit per minute)...`);
  await sleep(WAIT_MS);
}

const big = await call('20 findings (token counts only)', twenty, false);
print('');
print('--- summary ---');
for (const line of summary) print(line);
print(
  `20 findings: prompt_tokens=${seen.usage?.prompt_tokens ?? 'n/a'}, completion_tokens=${seen.usage?.completion_tokens ?? 'n/a'}${big === null ? ' (the call failed)' : ''}`,
);
if (anyRejected) process.exitCode = 2;
