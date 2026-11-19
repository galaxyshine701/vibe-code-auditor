import { redact } from '../prover/redact.js';

/**
 * Shapes of keys that are removed even when the exact value is not known:
 * a JWT (Supabase anon / service keys, user tokens), the new Supabase key
 * prefixes and a Groq key.
 */
const KEY_SHAPES: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g,
  /gsk_[A-Za-z0-9]{20,}/g,
];

/** A secret shorter than this (or only spaces) is ignored: replacing it would wreck ordinary text. */
const MIN_SECRET_LENGTH = 6;

function cleanText(text: string, secrets: readonly string[]): string {
  const usable = secrets.filter((s) => s.trim().length >= MIN_SECRET_LENGTH);
  let out = redact(text, usable);
  for (const shape of KEY_SHAPES) out = out.replace(shape, '[REDACTED]');
  return out;
}

/**
 * The persist boundary: everything that is written to the audit store goes
 * through here first (findings, error, cleanupNote, report message, re-test
 * error). Returns a deep copy where every text has the known secret values and
 * the key shapes replaced by [REDACTED]. Object keys are never changed.
 */
export function redactForStorage<T>(value: T, secrets: readonly string[]): T {
  return walk(value, secrets) as T;
}

function walk(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return cleanText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => walk(item, secrets));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = walk(item, secrets);
    }
    return out;
  }
  return value;
}
