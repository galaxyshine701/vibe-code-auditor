/** How long one request to Supabase may take before we give up. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Plain error for a request that took too long. It never contains a URL or a key. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('Supabase did not answer in time.');
    this.name = 'RequestTimeoutError';
  }
}

/** Turns an abort error (a stalled response body, for example) into the plain timeout error. */
export function toPlainError(error: unknown): unknown {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError'
    ? new RequestTimeoutError()
    : error;
}

/**
 * A fetch with its own timer for EVERY request. There is no signal shared
 * between requests, so one slow request can never stop the cleanup calls that
 * come later.
 *
 * The timer also covers a response body that stalls after the headers came in
 * (the request is aborted then, and reading the body fails). It is unref'd, so
 * it never keeps the process alive.
 */
export function timedFetch(
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        reject(new RequestTimeoutError());
        controller.abort();
      }, timeoutMs);
      timer.unref();

      // honour a signal the caller passed in as well
      const outer = init?.signal;
      if (outer) {
        if (outer.aborted) controller.abort();
        else outer.addEventListener('abort', () => controller.abort());
      }

      baseFetch(input, { ...init, signal: controller.signal }).then(
        (response) => resolve(response),
        (error: unknown) => {
          // If our timer already fired, the promise was rejected with the
          // plain timeout error and this second rejection is ignored.
          clearTimeout(timer);
          reject(error);
        },
      );
    });
}
