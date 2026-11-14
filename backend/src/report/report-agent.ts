import type { Agent } from '../agents/agent.js';
import type { RunContext } from '../agents/prover-agent.js';
import type { Finding } from '../prover/types.js';
import { BUDGET_MS, CALL_TIMEOUT_MS, MAX_FINDINGS_PER_CALL } from './limits.js';
import { LlmError, type LlmClient } from './llm-client.js';
import { buildPrompt, RESPONSE_SCHEMA } from './report-prompt.js';
import { parseChunk } from './report-validate.js';

export const REPORT_AGENT_ID = 'report-agent';

export interface ReportAgentOptions {
  /** null when the key or the model is missing; `problem` then says which. */
  llm: LlmClient | null;
  problem?: string | null;
  callTimeoutMs?: number;
  budgetMs?: number;
  now?: () => number;
}

function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new LlmError('timeout'));
    }, ms);
    run(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof LlmError ? error : new LlmError('network'));
      },
    );
  });
}

/**
 * The Report agent. It may rewrite only explanation.en (and sets
 * explanationSource). Verdict, severity, title, explanation.ur, evidence,
 * fix and retest always stay as the Prover made them. It writes into
 * context.prover.findings; the Prover result is never replaced.
 *
 * If some or all text cannot be used, the Prover's own text stays for those
 * findings and the agent throws at the end with a fixed sentence, so its row
 * shows "failed" while the audit still completes. Nothing here logs a
 * request or an answer.
 */
export function createReportAgent(
  options: ReportAgentOptions,
): Agent<RunContext> {
  const callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? BUDGET_MS;
  const now = options.now ?? Date.now;

  return {
    id: REPORT_AGENT_ID,
    name: 'Report agent',
    critical: false,
    async run(context, setProgress) {
      const findings = context.prover?.findings;
      if (!findings) throw new Error('There were no findings to write about.');

      // Every finding starts with the Prover's own text.
      for (let i = 0; i < findings.length; i++) {
        findings[i] = { ...findings[i], explanationSource: 'template' };
      }
      if (findings.length === 0) return;

      if (!options.llm) {
        throw new Error(
          `${options.problem ?? 'The AI service is not set up.'} Template text kept.`,
        );
      }

      const chunks: Finding[][] = [];
      for (let i = 0; i < findings.length; i += MAX_FINDINGS_PER_CALL) {
        chunks.push(findings.slice(i, i + MAX_FINDINGS_PER_CALL));
      }

      const started = now();
      let notUsed = 0;
      let reason = '';
      let stop = false;

      for (const [index, chunk] of chunks.entries()) {
        if (stop || now() - started > budgetMs) {
          notUsed += chunk.length;
          if (!stop) reason ||= 'the time limit was reached';
          continue;
        }
        try {
          const prompt = buildPrompt(chunk);
          const answer = await withTimeout(
            (signal) =>
              options.llm!.generate(
                { ...prompt, schema: RESPONSE_SCHEMA },
                signal,
              ),
            callTimeoutMs,
          );
          if (answer.finishReason === 'length') throw new LlmError('truncated');

          const parsed = parseChunk(answer.content, chunk);
          for (const [id, text] of parsed.accepted) {
            const at = findings.findIndex((f) => f.id === id);
            findings[at] = {
              ...findings[at],
              explanation: { ...findings[at].explanation, en: text },
              explanationSource: 'ai',
            };
          }
          if (parsed.rejected > 0) {
            notUsed += parsed.rejected;
            reason ||= parsed.unusable
              ? 'the AI answer could not be read'
              : 'some AI text did not pass the checks';
          }
        } catch (error) {
          notUsed += chunk.length;
          const kind = error instanceof LlmError ? error.kind : 'network';
          reason ||=
            error instanceof LlmError ? error.message : 'the AI call failed';
          // No point asking again when the service refuses everything.
          if (kind === 'rate_limited' || kind === 'auth') stop = true;
        }
        setProgress(Math.round(((index + 1) / chunks.length) * 100));
      }

      if (notUsed > 0) {
        throw new Error(
          `AI text was not used for ${notUsed} of ${findings.length} findings (${reason}). Template text kept for those.`,
        );
      }
    },
  };
}
