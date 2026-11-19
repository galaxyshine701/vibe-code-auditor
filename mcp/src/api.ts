import type { Config } from './config.js';

/** An error whose message is meant for the model (it is redacted again before it leaves). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface Api {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

const TIMEOUT_MS = 20_000;

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Our own wording for the common failures; the server's text only where it is about the request. */
function describe(status: number, body: unknown, retryAfter: string | null) {
  const error = (body as ErrorBody | null)?.error;
  const code = asText(error?.code);
  const message = asText(error?.message);

  if (status === 401 || status === 403) {
    return new ToolError(
      'The server rejected the access code. Check VCA_ACCESS_CODE in mcp/.env.',
    );
  }
  if (status === 404) {
    return new ToolError(
      'NOT_FOUND: no audit with this id. The server keeps audits in memory only, so a restart removes them.',
      'NOT_FOUND',
    );
  }
  if (status === 429) {
    const seconds = Number.parseInt(retryAfter ?? '', 10);
    return new ToolError(
      Number.isFinite(seconds)
        ? `RATE_LIMITED: too many requests. Try again in ${seconds} seconds.`
        : 'RATE_LIMITED: too many requests. Try again later.',
    );
  }
  if ((status === 400 || status === 409) && message) {
    return new ToolError(code ? `${code}: ${message}` : message, code);
  }
  return new ToolError(`The server answered with an error (HTTP ${status}).`);
}

export function createApi(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): Api {
  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${config.apiUrl}/api/v1${path}`, {
        method,
        headers: {
          'x-access-code': config.accessCode,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The original error text can contain the address, so it is not passed on.
      throw new ToolError(
        'Cannot reach the audit server, or it did not answer in time. Check VCA_API_URL and that the server is running.',
      );
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw describe(
        response.status,
        parsed,
        response.headers.get('retry-after'),
      );
    }
    return parsed;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}
