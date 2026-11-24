import { scanForKeys } from '../stages/site-rules.js';

/**
 * Rule 3 of Repo Scan: a committed env file (.env, .env.local, .env.production,
 * ...) that holds a variable with a secret-looking NAME and a real-looking
 * value. The zip of a repository holds only committed files, so such a file
 * being there is the finding.
 *
 * The answer is never "leaked": the value is not tested. It is a warning sign
 * (INCONCLUSIVE). Only the file, the 1-based line of the first such variable
 * and the NAMES of the variables are returned, never a value. Plain code.
 *
 * A line whose value matches a known key format is left out: the key rule
 * already reports that one (as a leak). A NEXT_PUBLIC_ / VITE_ name that says
 * SECRET or SERVICE_ROLE is left out too: rule 2 reports it.
 */

export interface EnvFileHit {
  path: string;
  /** the 1-based line of the first such variable in the file */
  line: number;
  /** the names (at most MAX_NAMES_PER_FILE), in file order */
  names: string[];
  /** how many more such variables the file has */
  more: number;
}

/** The most files that are listed (the rest are not). */
export const MAX_ENV_FILE_HITS = 50;
/** The most variable names named for one file. */
export const MAX_NAMES_PER_FILE = 5;

const EXAMPLE_SUFFIX = /(?:^|\.)(?:example|sample|template)$/i;

/**
 * A committed env file by its name: ".env" or ".env.<something>", but not an
 * example, sample or template (".env.example", ".env.sample", ".env.template",
 * ".env.local.example").
 */
export function isEnvFile(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  if (!/^\.env(?:\..+)?$/i.test(base)) return false;
  return !EXAMPLE_SUFFIX.test(base);
}

const SINGLE = new Set([
  'SECRET',
  'SECRETS',
  'PASSWORD',
  'PASSWD',
  'PASSPHRASE',
  'TOKEN',
  'APIKEY',
  'CREDENTIAL',
  'CREDENTIALS',
]);
const PAIRS = new Set([
  'API_KEY',
  'PRIVATE_KEY',
  'ACCESS_KEY',
  'SECRET_KEY',
  'SERVICE_ROLE',
  'SERVICE_KEY',
  'AUTH_KEY',
  'SIGNING_KEY',
  'ENCRYPTION_KEY',
]);
/** A name that says the value is meant to be public. */
const PUBLIC_WORD = /(?:^|_)(?:PUBLISHABLE|ANON|PUBLIC)(?:_|$)/i;
const PUBLIC_SECRET_NAME =
  /^(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE)[A-Z0-9_]*$/;

/** True when the variable NAME looks like it holds a secret. */
export function isSecretName(name: string): boolean {
  if (name.length > 64) return false;
  const upper = name.toUpperCase();
  if (PUBLIC_WORD.test(upper)) return false;
  const parts = upper.split('_').filter(Boolean);
  if (parts.some((part) => SINGLE.has(part))) return true;
  for (let i = 0; i + 1 < parts.length; i += 1) {
    if (PAIRS.has(`${parts[i]}_${parts[i + 1]}`)) return true;
  }
  return false;
}

/** A value that is only an empty or example text, or a reference to another variable. */
export function isPlaceholderValue(value: string): boolean {
  const v = value.trim();
  if (v === '') return true;
  if (/x{4,}|your[_-]|example|changeme|change[_-]me|placeholder|replace[_-]?me/i.test(v)) {
    return true;
  }
  if (/^<[^>]*>$|\.{3}|\*{3,}/.test(v)) return true;
  // a reference such as ${OTHER_VAR} or $OTHER_VAR
  return /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v);
}

/** A value that is too plain to be a secret: a flag, a number, or very short. */
function isPlainValue(value: string): boolean {
  return value.length < 6 || /^(?:true|false|null|none|undefined|\d+)$/i.test(value);
}

/** The value of a line "NAME=value": quotes and a trailing comment removed. */
function valueOf(raw: string): string {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    return end === -1 ? text.slice(1) : text.slice(1, end);
  }
  const hash = text.search(/\s#/);
  return (hash === -1 ? text : text.slice(0, hash)).trim();
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * The secret-looking variables with a value in one env file's text: their
 * names (in file order) and the line of the first.
 */
export function findSecretVariables(
  text: string,
): { line: number; names: string[]; more: number } | null {
  const names: string[] = [];
  let first = 0;
  let more = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    const match = ASSIGNMENT.exec(line);
    if (!match) continue;
    const name = match[1];
    if (!isSecretName(name) || PUBLIC_SECRET_NAME.test(name)) continue;
    const value = valueOf(match[2]);
    if (isPlaceholderValue(value) || isPlainValue(value)) continue;
    // a known key format is the key rule's: it reports that line as a leak
    if (scanForKeys(line).length > 0) continue;
    if (first === 0) first = i + 1;
    if (names.length < MAX_NAMES_PER_FILE) {
      if (!names.includes(name)) names.push(name);
    } else {
      more += 1;
    }
  }
  return first === 0 ? null : { line: first, names, more };
}
