import type { INestApplication } from '@nestjs/common';
import { resolveTrustProxyHops } from './access/access-config.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

export const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';

/**
 * The one browser origin allowed to call this API (env FRONTEND_ORIGIN).
 * Must be a plain origin like https://app.example.com. "*" is refused.
 */
export function resolveAllowedOrigin(
  env: Record<string, string | undefined>,
): string {
  const raw = env.FRONTEND_ORIGIN?.trim() || DEFAULT_FRONTEND_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'FRONTEND_ORIGIN must be a URL such as http://localhost:3000',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('FRONTEND_ORIGIN must start with http:// or https://');
  }
  return url.origin;
}

/** Settings shared by the real server and the tests. */
export function configureApp(
  app: INestApplication,
  env: Record<string, string | undefined> = process.env,
): void {
  // /health stays at the root; everything else lives under /api/v1
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: resolveAllowedOrigin(env),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Access-Code'],
  });

  // How many reverse proxies (for example Railway) stand in front of us.
  // This decides which address counts as the client's: with 0 the
  // X-Forwarded-For header is ignored, so it cannot be faked. Behind Railway
  // set TRUST_PROXY_HOPS=1, otherwise every client looks like the proxy.
  const hops = resolveTrustProxyHops(env);
  const express = app.getHttpAdapter().getInstance() as {
    set(name: string, value: unknown): void;
  };
  express.set('trust proxy', hops);
}
