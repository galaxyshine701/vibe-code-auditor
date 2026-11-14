// Limits for the Report agent. Numbers are explained here so they can be checked.

/** Most findings sent to the AI in one call. More findings go in more calls. */
export const MAX_FINDINGS_PER_CALL = 20;

/** Longest accepted explanation, in characters. */
export const MAX_EXPLANATION_CHARS = 400;

/**
 * Most tokens the AI may generate in one call (Groq: max_completion_tokens).
 *
 *   one explanation        400 characters / about 4 characters per token = 100 tokens
 *   JSON around it         id and keys, about 25 tokens
 *   one finding            125 tokens
 *   one call               20 findings x 125 tokens = 2,500 tokens
 *   reasoning headroom     2,000 tokens (reasoning_effort "low"). This is an
 *                          assumption: the Groq docs give no number, and they
 *                          do not say whether reasoning tokens are counted here.
 *   margin                 30 percent
 *
 *   (2,500 + 2,000) x 1.3 = 5,850, rounded up to 6,000.
 *
 * The model allows up to 65,536 output tokens, so this is far below its limit.
 * The smoke script prints the real usage so this estimate can be checked.
 */
export const MAX_COMPLETION_TOKENS = 6_000;

/** Longest wait for one AI call. */
export const CALL_TIMEOUT_MS = 20_000;

/** Longest time for all AI calls of one audit. */
export const BUDGET_MS = 45_000;

/** Change this number whenever the prompt changes. */
export const PROMPT_VERSION = 2;
