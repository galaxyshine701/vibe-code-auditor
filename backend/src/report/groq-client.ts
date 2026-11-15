import { MAX_COMPLETION_TOKENS } from './limits.js';
import { LlmError, type LlmAnswer, type LlmClient } from './llm-client.js';

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Groq chat completions (OpenAI compatible), checked against the Groq docs:
 * - response_format json_schema with strict:true is supported for openai/gpt-oss-20b
 * - reasoning_effort (low | medium | high) and include_reasoning exist for gpt-oss
 * - reasoning_format is NOT supported for gpt-oss, so it is not sent
 * - max_completion_tokens is the token limit (max_tokens is deprecated)
 *
 * This code never logs the request or the answer. It reads only
 * choices[0].message.content and choices[0].finish_reason. The `reasoning`
 * field of the message is never read.
 */
export function createGroqClient(options: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async generate(request, signal): Promise<LlmAnswer> {
      let response: Response;
      try {
        response = await fetchImpl(GROQ_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            temperature: 0.2,
            reasoning_effort: 'low',
            include_reasoning: false,
            max_completion_tokens: MAX_COMPLETION_TOKENS,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'report_explanations',
                strict: true,
                schema: request.schema,
              },
            },
          }),
          signal,
        });
      } catch (error) {
        const aborted =
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError');
        throw new LlmError(aborted ? 'timeout' : 'network');
      }

      if (response.status === 429) throw new LlmError('rate_limited');
      if (response.status === 401 || response.status === 403) {
        throw new LlmError('auth');
      }
      if (!response.ok) throw new LlmError('http');

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LlmError('empty');
      }
      const choice = (
        body as {
          choices?: {
            message?: { content?: unknown };
            finish_reason?: unknown;
          }[];
        }
      )?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LlmError('empty');
      }
      return {
        content,
        finishReason:
          typeof choice?.finish_reason === 'string'
            ? choice.finish_reason
            : null,
      };
    },
  };
}
