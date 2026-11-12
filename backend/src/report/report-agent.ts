import type { Finding } from '../prover/types.js';
import { LlmError, type LlmClient } from './llm-client.js';
import { buildPrompt, PROMPT_VERSION } from './report-prompt.js';
import { buildReportInput } from './report-input.js';
import { ReportCache } from './report-cache.js';
import {
  parseReport,
  REPORT_JSON_SCHEMA,
  type ReportText,
} from './report-schema.js';

export const REPORT_AGENT = Symbol('REPORT_AGENT');

/** What AuditsService needs. It never throws. */
export interface ReportEnricher {
  enrich(findings: Finding[]): Promise<Finding[]>;
}

export interface ReportAgentOptions {
  /** Without a client every finding keeps the Prover's own text. */
  llm?: LlmClient;
  cache?: ReportCache;
  now?: () => number;
  /** Receives fixed sentences only: never a key, a table name or the AI's text. */
  log?: (message: string) => void;
  /** Longest wait for one AI call. */
  callTimeoutMs?: number;
  /** Longest time for the whole AI step of one audit. */
  budgetMs?: number;
  /** After a failed AI call, skip the AI for this long. */
  breakerMs?: number;
}

const MAX_PAUSE_MS = 5 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LlmError('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new LlmError('network'));
      },
    );
  });
}

/**
 * The Report agent. The AI may only reword four texts (title, English and
 * Roman Urdu explanation, fix description). Verdict, severity, evidence and
 * the fix SQL always stay exactly as the Prover made them. If the AI is off,
 * slow, rate limited or answers badly, the Prover's own text is kept, so an
 * audit never fails and a demo never waits because of the AI.
 */
export class ReportAgent implements ReportEnricher {
  private readonly llm?: LlmClient;
  private readonly cache: ReportCache;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly callTimeoutMs: number;
  private readonly budgetMs: number;
  private readonly breakerMs: number;
  private pausedUntil = 0;

  constructor(options: ReportAgentOptions = {}) {
    this.llm = options.llm;
    this.cache = options.cache ?? new ReportCache();
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.callTimeoutMs = options.callTimeoutMs ?? 6_000;
    this.budgetMs = options.budgetMs ?? 15_000;
    this.breakerMs = options.breakerMs ?? 60_000;
  }

  async enrich(findings: Finding[]): Promise<Finding[]> {
    const startedAt = this.now();
    const result: Finding[] = [];
    // One at a time, so a free-tier rate limit is not hit by parallel calls.
    for (const finding of findings) {
      try {
        result.push(await this.enrichOne(finding, startedAt));
      } catch {
        result.push(this.asTemplate(finding));
      }
    }
    return result;
  }

  private async enrichOne(
    finding: Finding,
    startedAt: number,
  ): Promise<Finding> {
    const llm = this.llm;
    if (!llm) return this.asTemplate(finding);

    const input = buildReportInput(finding);
    const key = ReportCache.key(input, llm.model, PROMPT_VERSION);
    const cached = this.cache.get(key);
    if (cached) return this.asAi(finding, cached);

    if (this.now() < this.pausedUntil) return this.asTemplate(finding);
    const remaining = this.budgetMs - (this.now() - startedAt);
    if (remaining <= 0) {
      this.log('AI time budget used up; using the built-in text.');
      return this.asTemplate(finding);
    }

    const prompt = buildPrompt(input);
    const timeoutMs = Math.min(this.callTimeoutMs, remaining);
    let raw: string;
    try {
      raw = await withTimeout(
        llm.generate({ ...prompt, schema: REPORT_JSON_SCHEMA, timeoutMs }),
        timeoutMs,
      );
    } catch (error) {
      const failure =
        error instanceof LlmError ? error : new LlmError('network');
      const wait = Math.min(
        Math.max((failure.retryAfterSeconds ?? 0) * 1000, this.breakerMs),
        MAX_PAUSE_MS,
      );
      this.pausedUntil = this.now() + wait;
      this.log(
        `AI call failed (${failure.kind}); using the built-in text for ${Math.round(wait / 1000)} seconds.`,
      );
      return this.asTemplate(finding);
    }

    const parsed = parseReport(raw, {
      verdict: finding.verdict,
      hasFix: input.hasFix,
    });
    if (!parsed.ok) {
      this.log(
        `AI answer rejected (${parsed.reason}); using the built-in text.`,
      );
      return this.asTemplate(finding);
    }
    this.cache.set(key, parsed.value);
    return this.asAi(finding, parsed.value);
  }

  private asTemplate(finding: Finding): Finding {
    return { ...finding, explanationSource: 'template' };
  }

  /** Only the four texts are taken from the AI. Everything else is the Prover's. */
  private asAi(finding: Finding, text: ReportText): Finding {
    return {
      ...finding,
      title: text.title,
      explanation: { en: text.explanationEn, ur: text.explanationUr },
      fix: finding.fix
        ? { ...finding.fix, description: text.fixDescription }
        : null,
      explanationSource: 'ai',
    };
  }
}
