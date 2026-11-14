import type { Config } from './config.js';

const MIN_SECRET_LENGTH = 4;

/** Every value from the environment that must never reach the model. */
export function secretsOf(config: Config): string[] {
  const hostname = (() => {
    try {
      return new URL(config.supabaseUrl).hostname;
    } catch {
      return '';
    }
  })();
  const base = [
    config.accessCode,
    config.publishableKey,
    config.secretKey,
    config.supabaseUrl,
    hostname,
  ];
  return base.flatMap((s) => [s, encodeURIComponent(s)]);
}

/** Replaces every secret value in a text with [REDACTED]. */
export function makeRedactor(secrets: string[]): (text: string) => string {
  const list = [...new Set(secrets)]
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const secret of list) out = out.split(secret).join('[REDACTED]');
    return out;
  };
}
