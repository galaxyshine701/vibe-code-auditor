/** Everything the server needs comes from environment variables, never from a tool input. */
export class ConfigError extends Error {}

export interface Config {
  apiUrl: string;
  accessCode: string;
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  /** true only when VCA_CONFIRM_TEST_PROJECT=yes */
  confirmTestProject: boolean;
}

const REQUIRED = [
  'VCA_API_URL',
  'VCA_ACCESS_CODE',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
] as const;

export const MIN_ACCESS_CODE_LENGTH = 8;

function checkUrl(name: string, value: string, httpsOnly: boolean): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a valid web address.`);
  }
  const ok = httpsOnly
    ? url.protocol === 'https:'
    : url.protocol === 'https:' || url.protocol === 'http:';
  if (!ok) {
    throw new ConfigError(
      `${name} must start with ${httpsOnly ? 'https://' : 'https:// or http://'}.`,
    );
  }
}

/**
 * Reads and checks the settings. Error and warning texts name a variable or
 * the file, and never print a value.
 */
export function loadConfig(env: NodeJS.ProcessEnv): {
  config: Config;
  warnings: string[];
} {
  const value = (name: string) => (env[name] ?? '').trim();
  const missing = REQUIRED.filter((name) => value(name) === '');

  if (missing.length === REQUIRED.length) {
    throw new ConfigError(
      'No settings found. mcp/.env is missing or empty. Copy mcp/.env.example to mcp/.env and fill it in (see mcp/README.md).',
    );
  }
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing in mcp/.env: ${missing.join(', ')}. See mcp/.env.example.`,
    );
  }

  checkUrl('VCA_API_URL', value('VCA_API_URL'), false);
  checkUrl('SUPABASE_URL', value('SUPABASE_URL'), true);

  const warnings: string[] = [];
  if (value('VCA_ACCESS_CODE').length < MIN_ACCESS_CODE_LENGTH) {
    warnings.push(
      `VCA_ACCESS_CODE is shorter than ${MIN_ACCESS_CODE_LENGTH} characters. Use a long random code.`,
    );
  }

  return {
    config: {
      apiUrl: value('VCA_API_URL').replace(/\/+$/, ''),
      accessCode: value('VCA_ACCESS_CODE'),
      supabaseUrl: value('SUPABASE_URL').replace(/\/+$/, ''),
      publishableKey: value('SUPABASE_PUBLISHABLE_KEY'),
      secretKey: value('SUPABASE_SECRET_KEY'),
      confirmTestProject: value('VCA_CONFIRM_TEST_PROJECT') === 'yes',
    },
    warnings,
  };
}
