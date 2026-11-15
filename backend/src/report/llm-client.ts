export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema the answer must follow. */
  schema: object;
}

/** Only the final message text and why it stopped. Reasoning is never read. */
export interface LlmAnswer {
  content: string;
  finishReason: string | null;
}

/** A connection to one AI provider. */
export interface LlmClient {
  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmAnswer>;
}

export type LlmErrorKind =
  | 'rate_limited'
  | 'auth'
  | 'timeout'
  | 'http'
  | 'network'
  | 'truncated'
  | 'empty';

const SENTENCES: Record<LlmErrorKind, string> = {
  rate_limited: 'the AI service is rate limited',
  auth: 'the AI service did not accept the key',
  timeout: 'the AI service did not answer in time',
  http: 'the AI service answered with an error',
  network: 'the AI service could not be reached',
  truncated: 'the AI answer was cut off',
  empty: 'the AI answer was empty',
};

/**
 * A failed AI call. The message is a fixed sentence per kind. It never quotes
 * the request, the provider's answer or a key.
 */
export class LlmError extends Error {
  constructor(public readonly kind: LlmErrorKind) {
    super(SENTENCES[kind]);
  }
}
