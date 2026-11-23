import type { INestApplication } from '@nestjs/common';
import { resolveTrustProxyHops } from './access/access-config.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

export const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';

/**
 * The browser origins allowed to call this API (env FRONTEND_ORIGIN): one
 * origin, or several separated by commas. Each one is an exact origin such as
 * https://app.example.com (spaces around it are trimmed, a path is dropped).
 * Only https is accepted, and http only for localhost (development). "*" and
 * any other pattern is refused. Empty = http://localhost:3000.
 */
export function resolveAllowedOrigins(
  env: Record<string, string | undefined>,
): string[] {
  const parts = (env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return [DEFAULT_FRONTEND_ORIGIN];

  const origins: string[] = [];
  for (const raw of parts) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(
        'FRONTEND_ORIGIN must be one or more origins such as https://app.example.com, separated by commas',
      );
    }
    // a wildcard (or any odd character) in the host is never an exact origin
    if (!/^[a-z0-9.-]+$/i.test(url.hostname)) {
      throw new Error('FRONTEND_ORIGIN must list exact origins: no wildcard');
    }
    const allowed =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && url.hostname === 'localhost');
    if (!allowed) {
      throw new Error(
        'FRONTEND_ORIGIN must use https:// (http:// only for localhost)',
      );
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}

/** Settings shared by the real server and the tests. */
export function configureApp(
  app: INestApplication,
  env: Record<string, string | undefined> = process.env,
): void {
  // /health stays at the root; everything else lives under /api/v1
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new ApiExceptionFilter());
  const origins = resolveAllowedOrigins(env);
  app.enableCors({
    // one origin: as before (always that origin in the answer); several: the
    // caller's origin is answered only when it is in the list
    origin: origins.length === 1 ? origins[0] : origins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Access-Code'],
    exposedHeaders: ['Retry-After'],
  });

  // How many reverse proxies (for example Railway) stand in front of us.
  // This decides which address counts as the client's: with 0 the
  // X-Forwarded-For header is ignored, so it cannot be faked. Behind Railway
  // set TRUST_PROXY_HOPS=1, otherwise every client looks like the proxy.
  // On Railway the better source is CLIENT_IP_HEADER=x-real-ip (see README).
  const hops = resolveTrustProxyHops(env);
  const express = app.getHttpAdapter().getInstance() as {
    set(name: string, value: unknown): void;
  };
  express.set('trust proxy', hops);
}
