/** Replaces every known secret value in a text with [REDACTED]. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  return out;
}
