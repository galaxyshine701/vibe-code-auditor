import { ProverError, type ProverConfig } from './types.js';

/**
 * Reads the settings from an env-like object (process.env in real use).
 * Refuses to run unless CONFIRM_TEST_PROJECT is exactly "yes".
 * Error messages name the variable only, never a value.
 */
export function loadConfig(
  env: Record<string, string | undefined>,
): ProverConfig {
  const missing = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'CONFIRM_TEST_PROJECT',
  ].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new ProverError(
      'MISSING_ENV',
      `Missing environment variables: ${missing.join(', ')}. Fill them in backend/.env.`,
    );
  }
  if (env.CONFIRM_TEST_PROJECT!.trim() !== 'yes') {
    throw new ProverError(
      'TEST_PROJECT_NOT_CONFIRMED',
      'Refusing to run. Set CONFIRM_TEST_PROJECT=yes only if this is a TEST project.',
    );
  }
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL!.trim());
  } catch {
    throw new ProverError('INVALID_INPUT', 'SUPABASE_URL is not a valid URL.');
  }
  return {
    supabaseUrl: url.origin,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY!.trim(),
    secretKey: env.SUPABASE_SECRET_KEY!.trim(),
  };
}
