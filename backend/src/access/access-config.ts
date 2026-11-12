export const MIN_ACCESS_CODE_LENGTH = 24;

export type AccessConfig = { mode: 'code'; code: string } | { mode: 'open' };

/**
 * Decides how the audits API is protected. It fails CLOSED:
 * - AUDIT_ACCESS_CODE set (24+ characters)  -> the code is required.
 * - not set, but ALLOW_OPEN_API=yes         -> open (local testing only).
 * - anything else                           -> throws, so the server does not start.
 *
 * A code that is too short never falls back to "open", even when
 * ALLOW_OPEN_API=yes. The messages name the variable only, never a value.
 */
export function resolveAccessConfig(
  env: Record<string, string | undefined>,
): AccessConfig {
  const code = env.AUDIT_ACCESS_CODE?.trim();
  if (code) {
    if (code.length < MIN_ACCESS_CODE_LENGTH) {
      throw new Error(
        `AUDIT_ACCESS_CODE must be at least ${MIN_ACCESS_CODE_LENGTH} characters long.`,
      );
    }
    return { mode: 'code', code };
  }
  if (env.ALLOW_OPEN_API?.trim().toLowerCase() === 'yes') {
    return { mode: 'open' };
  }
  throw new Error(
    `AUDIT_ACCESS_CODE is not set. Set it to a secret of at least ${MIN_ACCESS_CODE_LENGTH} characters. ` +
      'For local testing only, you can set ALLOW_OPEN_API=yes instead (no access code at all).',
  );
}

/** How many reverse proxies stand in front of the server (0 = none). */
export function resolveTrustProxyHops(
  env: Record<string, string | undefined>,
): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return 0;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be a whole number from 0 to 5.');
  }
  return hops;
}

/**
 * Headers that must never be used as the client address: they carry secrets,
 * or are lists whose first part the client can write itself.
 */
const FORBIDDEN_IP_HEADERS = new Set([
  'x-access-code',
  'authorization',
  'cookie',
  'set-cookie',
  'host',
  'content-type',
  'content-length',
  'x-forwarded-for',
  'forwarded',
]);

/**
 * Which header holds the real client address (for example x-real-ip on
 * Railway). null = not set: the guard then uses request.ip as before.
 * The messages name the variable only, never the value.
 */
export function resolveClientIpHeader(
  env: Record<string, string | undefined>,
): string | null {
  const raw = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-z0-9-]{1,64}$/.test(raw)) {
    throw new Error(
      'CLIENT_IP_HEADER must be a valid header name, for example x-real-ip.',
    );
  }
  if (FORBIDDEN_IP_HEADERS.has(raw)) {
    throw new Error(
      'CLIENT_IP_HEADER cannot be that header. Use one that your proxy sets to the client address alone, for example x-real-ip.',
    );
  }
  return raw;
}
