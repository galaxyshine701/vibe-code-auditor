import { createGroqClient } from './groq-client.js';
import type { LlmClient } from './llm-client.js';

export const REPORT_SETUP = Symbol('REPORT_SETUP');

/** How the Report agent is set up. Built once from the environment. */
export type ReportSetup =
  | { mode: 'off' }
  | {
      mode: 'groq';
      /** null when the key or the model is missing */
      llm: LlmClient | null;
      problem: string | null;
      /** The key, only so it can be redacted from any text. Never logged. */
      secret: string;
    };

/**
 * REPORT_AGENT=off|groq (default off). GROQ_API_KEY and GROQ_MODEL come from
 * the environment only. Warnings are fixed sentences: no value is printed.
 */
export function resolveReportSetup(
  env: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
): { setup: ReportSetup; warnings: string[] } {
  const raw = (env.REPORT_AGENT ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'off')
    return { setup: { mode: 'off' }, warnings: [] };
  if (raw !== 'groq') {
    return {
      setup: { mode: 'off' },
      warnings: [
        'REPORT_AGENT must be "off" or "groq". The Report agent is off.',
      ],
    };
  }

  const apiKey = (env.GROQ_API_KEY ?? '').trim();
  const model = (env.GROQ_MODEL ?? '').trim();
  const missing = [
    ...(apiKey ? [] : ['GROQ_API_KEY']),
    ...(model ? [] : ['GROQ_MODEL']),
  ];
  if (missing.length > 0) {
    const problem = `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.`;
    return {
      setup: { mode: 'groq', llm: null, problem, secret: apiKey },
      warnings: [
        `REPORT_AGENT=groq but ${problem} Template text will be used.`,
      ],
    };
  }
  return {
    setup: {
      mode: 'groq',
      llm: createGroqClient({ apiKey, model, fetchImpl }),
      problem: null,
      secret: apiKey,
    },
    warnings: [],
  };
}
