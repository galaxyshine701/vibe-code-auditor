export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema the answer must follow. */
  schema: object;
  timeoutMs: number;
}

/** A connection to one AI provider. It returns the raw JSON text of the answer. */
export interface LlmClient {
  readonly model: string;
  generate(request: LlmRequest): Promise<string>;
}

export type LlmErrorKind = 'rate_limited' | 'timeout' | 'http' | 'network';

/**
 * A failed AI call. The message is a fixed sentence per kind: it never quotes
 * the provider's answer, the request or a key.
 */
export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`AI call failed (${kind}).`);
  }
}
