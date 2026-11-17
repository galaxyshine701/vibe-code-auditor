import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { pipeline, Readable } from 'node:stream';
import zlib from 'node:zlib';
import { isBlockedAddress, isBlockedHostName } from './ip-rules.js';

/**
 * SSRF-safe fetch for the inspectors: it fetches a page of a site the user
 * named, and must never be tricked into reaching our own network.
 *
 * - Only http: and https:, only ports 80 and 443, no user:password@ in the address.
 * - The host is judged before any connection: a name like localhost, an IP
 *   literal (decimal, hex and octal forms are turned into dotted form by the
 *   URL parser first), or every address the name resolves to. If ANY address is
 *   in a blocked range (loopback, private, link-local / metadata, ...) it is refused.
 * - The connection goes to the address that was checked (a pinned `lookup`), not
 *   to a second DNS answer, so DNS rebinding does not work. The URL is not
 *   rewritten: Host header and TLS server name stay the original name.
 * - Redirects are followed by hand, at most 5, and every Location is judged
 *   again from the start (scheme, port, host, DNS).
 * - One deadline for the whole call, and a size cap on the bytes AFTER
 *   decompression (Accept-Encoding: identity is asked for, but a server that
 *   compresses anyway is decoded with the same cap, so a zip bomb stops early).
 * - GET only, a fixed small set of request headers, no cookies, no credentials.
 */

export type SafeFetchErrorCode =
  | 'BAD_URL'
  | 'BLOCKED_SCHEME'
  | 'BLOCKED_PORT'
  | 'BLOCKED_HOST'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'BAD_REDIRECT'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'BAD_ENCODING'
  | 'NETWORK';

/** A fixed sentence per code. It never carries the address or a library message. */
const MESSAGES: Record<SafeFetchErrorCode, string> = {
  BAD_URL: 'The address is not a valid web address.',
  BLOCKED_SCHEME: 'Only http and https addresses are allowed.',
  BLOCKED_PORT: 'Only the standard web ports (80 and 443) are allowed.',
  BLOCKED_HOST: 'This host name is not allowed.',
  BLOCKED_ADDRESS: 'This address points to a network that is not allowed.',
  DNS_FAILED: 'The host name could not be resolved.',
  TOO_MANY_REDIRECTS: 'The address redirects too many times.',
  BAD_REDIRECT: 'The redirect answer could not be used.',
  TIMEOUT: 'The site did not answer in time.',
  TOO_LARGE: 'The answer is larger than the allowed size.',
  BAD_ENCODING: 'The answer uses an encoding that is not supported.',
  NETWORK: 'The site could not be reached.',
};

export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SafeFetchError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
/** Resolves a host name to ALL of its addresses. Replaced by a fake in tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  /** The address that was checked. The connection must go to exactly this one. */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer | Uint8Array>;
}
/** Makes one request. Replaced by a fake in tests. */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface SafeFetchOptions {
  /** One deadline for the whole call (DNS, every redirect, the body). Default 10 s. */
  timeoutMs?: number;
  /** Most bytes of the body after decompression. Default 2 MB. */
  maxBytes?: number;
  /** Most redirects that are followed. Default 5. */
  maxRedirects?: number;
  resolve?: Resolver;
  transport?: Transport;
}

export interface SafeFetchResult {
  /** The address that finally answered (after redirects). */
  url: string;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set(['', '80', '443']);

/** The only headers that are ever sent. */
const REQUEST_HEADERS: Record<string, string> = {
  'user-agent': 'vca-inspector/1 (+read-only checks)',
  accept: 'text/html,application/javascript,text/javascript,*/*;q=0.5',
  'accept-encoding': 'identity',
  connection: 'close',
};

// ---- the real network parts ---------------------------------------------

/** What Node's http(s).request calls to find the address: always the checked one. */
export function createPinnedLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    options: unknown,
    callback: (
      error: Error | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ): void => {
    // Node 20+ may ask for ALL addresses (autoSelectFamily): the answer is then an array.
    if ((options as { all?: boolean } | null)?.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

export const defaultResolver: Resolver = async (hostname) => {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family as 4 | 6 }));
};

export const defaultTransport: Transport = (req) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const lib = req.url.protocol === 'https:' ? https : http;
    const host = req.url.hostname.replace(/^\[|\]$/g, '');
    const request = lib.request(
      {
        hostname: host,
        port: req.url.port || (req.url.protocol === 'https:' ? 443 : 80),
        path: `${req.url.pathname}${req.url.search}`,
        method: 'GET',
        headers: req.headers,
        // no connection pool: a socket is never reused for another address
        agent: false,
        lookup: createPinnedLookup(req.address, req.family),
        // the certificate is checked against the NAME, not the pinned address
        ...(isIP(host) === 0 ? { servername: host } : {}),
      },
      (res) =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res,
        }),
    );
    const onAbort = () => request.destroy(new Error('aborted'));
    if (req.signal.aborted) onAbort();
    else req.signal.addEventListener('abort', onAbort, { once: true });
    request.on('error', reject);
    request.end();
  });

// ---- the checks ------------------------------------------------------------

function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('BAD_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('BLOCKED_SCHEME');
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError('BAD_URL');
  }
  if (!ALLOWED_PORTS.has(url.port)) throw new SafeFetchError('BLOCKED_PORT');
  return url;
}

/** Judges the host and returns the ONE address to connect to. */
async function pickAddress(
  url: URL,
  resolve: Resolver,
  signal: AbortSignal,
): Promise<ResolvedAddress> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const kind = isIP(host);
  if (kind !== 0) {
    // an IP literal: no DNS, judged as it is
    if (isBlockedAddress(host)) throw new SafeFetchError('BLOCKED_ADDRESS');
    return { address: host, family: kind as 4 | 6 };
  }
  if (isBlockedHostName(host)) throw new SafeFetchError('BLOCKED_HOST');
  let found: ResolvedAddress[];
  try {
    found = await raceWithSignal(resolve(host), signal);
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError('DNS_FAILED');
  }
  if (found.length === 0) throw new SafeFetchError('DNS_FAILED');
  // ALL answers must be allowed, not only the one that will be used
  if (found.some((f) => isBlockedAddress(f.address))) {
    throw new SafeFetchError('BLOCKED_ADDRESS');
  }
  return found[0];
}

/** Rejects with TIMEOUT as soon as the deadline signal fires. */
function raceWithSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(new SafeFetchError('TIMEOUT'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SafeFetchError('TIMEOUT'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function makeDecoder(encoding: string | undefined) {
  switch ((encoding ?? 'identity').toLowerCase().trim()) {
    case '':
    case 'identity':
      return null;
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      throw new SafeFetchError('BAD_ENCODING');
  }
}

/** Reads the body, counting the bytes AFTER decompression. */
async function readBody(
  response: TransportResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const declared = Number(singleHeader(response.headers['content-length']));
  const encoding = singleHeader(response.headers['content-encoding']);
  const decoder = makeDecoder(encoding);
  // a declared size is only a hint; for an identity body it can refuse early
  if (!decoder && Number.isFinite(declared) && declared > maxBytes) {
    destroy(response.body);
    throw new SafeFetchError('TOO_LARGE');
  }
  // pipeline() passes an error of the incoming stream on to the decoder, so
  // reading the decoder cannot hang when the connection drops
  const source: AsyncIterable<Buffer | Uint8Array> = decoder
    ? (pipeline(
        Readable.from(response.body),
        decoder,
        () => undefined,
      ) as unknown as AsyncIterable<Buffer>)
    : response.body;
  const chunks: Buffer[] = [];
  let total = 0;
  // The loop is driven by hand and raced against the deadline: a body that
  // drips for ever (or never yields) cannot hold the call past its deadline,
  // even if the stream has no destroy().
  const iterator = source[Symbol.asyncIterator]();
  const stop = () => {
    // best effort: never wait for a stream that is stuck
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
    destroy(source);
    destroy(response.body);
  };
  try {
    for (;;) {
      const step = await raceWithSignal(iterator.next(), signal);
      if (step.done) break;
      total += step.value.length;
      if (total > maxBytes) throw new SafeFetchError('TOO_LARGE');
      chunks.push(Buffer.from(step.value));
    }
  } catch (error) {
    stop();
    if (error instanceof SafeFetchError) throw error;
    if (signal.aborted) throw new SafeFetchError('TIMEOUT');
    // a broken compressed stream, or a connection that dropped
    throw new SafeFetchError(decoder ? 'BAD_ENCODING' : 'NETWORK');
  }
  return Buffer.concat(chunks);
}

function destroy(stream: unknown): void {
  const s = stream as { destroy?: (error?: Error) => void } | null;
  try {
    s?.destroy?.();
  } catch {
    // nothing to do
  }
}

/**
 * Fetches `rawUrl` (GET). Throws SafeFetchError with a fixed message; the
 * message never contains the address, so it is safe to show or store.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolve = options.resolve ?? defaultResolver;
  const transport = options.transport ?? defaultTransport;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  const { signal } = controller;

  try {
    let url = parseTarget(rawUrl);
    for (let hop = 0; ; hop++) {
      const target = await pickAddress(url, resolve, signal);
      let response: TransportResponse;
      try {
        response = await raceWithSignal(
          transport({
            url,
            address: target.address,
            family: target.family,
            headers: { ...REQUEST_HEADERS },
            signal,
          }),
          signal,
        );
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        throw new SafeFetchError(signal.aborted ? 'TIMEOUT' : 'NETWORK');
      }

      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      const location = singleHeader(response.headers.location);
      if (isRedirect && location) {
        destroy(response.body);
        if (hop >= maxRedirects) throw new SafeFetchError('TOO_MANY_REDIRECTS');
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new SafeFetchError('BAD_REDIRECT');
        }
        // the new address starts from the beginning: scheme, port, host, DNS
        url = parseTarget(next.href);
        continue;
      }

      const body = await readBody(response, maxBytes, signal);
      return {
        url: url.href,
        status: response.status,
        headers: response.headers,
        body,
      };
    }
  } finally {
    clearTimeout(timer);
    // anything still waiting on the deadline (a hanging transport) is released
    if (!signal.aborted) controller.abort();
  }
}
