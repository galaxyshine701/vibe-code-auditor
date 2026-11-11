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
