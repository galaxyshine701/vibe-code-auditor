export interface PlatformConfig {
  url: string;
  serviceKey: string;
}

/**
 * The connection to the platform's own Supabase project (where audits are
 * kept). These are NOT the keys of the project that is being tested.
 * The messages name the variables only, never a value.
 */
export function resolvePlatformConfig(
  env: Record<string, string | undefined>,
): PlatformConfig {
  const url = env.PLATFORM_SUPABASE_URL?.trim();
  const serviceKey = env.PLATFORM_SUPABASE_SERVICE_KEY?.trim();
  const missing = [
    !url ? 'PLATFORM_SUPABASE_URL' : '',
    !serviceKey ? 'PLATFORM_SUPABASE_SERVICE_KEY' : '',
  ].filter(Boolean);
  if (missing.length > 0 || !url || !serviceKey) {
    throw new Error(
      `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. The audit store needs the platform's own Supabase project.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('PLATFORM_SUPABASE_URL must be a valid web address.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('PLATFORM_SUPABASE_URL must start with https://.');
  }
  return { url: url.replace(/\/+$/, ''), serviceKey };
}
