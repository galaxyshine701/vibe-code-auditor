import type { INestApplication } from '@nestjs/common';
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
    allowedHeaders: ['Content-Type'],
  });
}
