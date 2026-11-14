import type { Finding } from '../prover/types.js';
import { MAX_EXPLANATION_CHARS } from './limits.js';

/** Claims the product must never make (R38). Run only after table names are removed. */
const BANNED =
  /\b(?:secure(?:d|s|ly)?|safe(?:ly|ty)?|certified|certificate|guarantee[ds]?)\b/i;

/** The text must not rate the finding: the Prover's severity is not for the AI to restate. */
const SEVERITY_WORDS =
  /\b(?:critical|severe(?:ly)?|severity|high|major|medium|minor|low)\b/i;

/**
 * Words that soften a fact. Not allowed on LEAKED and BLOCKED. "could" is
 * blocked only when it hedges ("could be", "could mean"): "could read" and
 * "could not" describe what an actor was able to do, so they stay allowed.
 */
const HEDGE_WORDS =
  /\b(?:indicat(?:e|es|ed|ing)|suggest(?:s|ed|ing)?|may|might|risks?|risky|potential(?:ly)?)\b|\bcould\s+(?:be|have|indicate|suggest|mean|lead|result|allow|expose|cause)\b/i;

const NOT_ALLOWED_SHAPE: RegExp[] = [
  /https?:\/\/|www\./i,
  /eyJ/,
  /sb_/i,
  /```/,
  /\b(?:create|alter|drop)\s+(?:policy|table)\b/i,
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f]/,
];

const NO_LEAK_PHRASE = /\bno leaks? (?:was |were )?found by these checks\b/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes the exact table names, so a table called safe_deposit cannot make a
 * correct answer look like a claim. A name is removed only as a whole word
 * (next to a letter, digit or underscore it stays), longest names first.
 */
export function removeTableNames(text: string, tables: string[]): string {
  let out = text;
  const names = [...new Set(tables)].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (!name) continue;
    out = out.replace(
      new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`, 'g'),
      ' ',
    );
  }
  return out;
}

export type TextProblem =
  | 'length'
  | 'shape'
  | 'claim'
  | 'severity'
  | 'hedge'
  | 'contradicts-verdict'
  | 'missing-leak';

/** Returns what is wrong with an explanation, or null when it can be used. */
export function checkExplanation(
  text: string,
  finding: Pick<Finding, 'verdict'>,
  tables: string[],
): TextProblem | null {
  if (text.length < 1 || text.length > MAX_EXPLANATION_CHARS) return 'length';
  if (NOT_ALLOWED_SHAPE.some((pattern) => pattern.test(text))) return 'shape';

  const stripped = removeTableNames(text, tables);
  if (BANNED.test(stripped)) return 'claim';
  if (SEVERITY_WORDS.test(stripped)) return 'severity';
  if (finding.verdict !== 'INCONCLUSIVE' && HEDGE_WORDS.test(stripped)) {
    return 'hedge';
  }

  if (finding.verdict === 'LEAKED') {
    if (/\bno leaks?\b|\bnot leak(?:ed|ing)?\b/i.test(stripped)) {
      return 'contradicts-verdict';
    }
    // A LEAKED finding must say so.
    if (!/\bleak(?:ed|s|ing)?\b/i.test(stripped)) return 'missing-leak';
  } else {
    const rest = stripped.replace(NO_LEAK_PHRASE, ' ');
    if (/\b(?:leaks?|leaked|leaking|exposed|vulnerable)\b/i.test(rest)) {
      return 'contradicts-verdict';
    }
  }
  return null;
}

export interface ParsedChunk {
  /** finding id -> text that passed every check */
  accepted: Map<string, string>;
  /** how many findings of the chunk got no usable text */
  rejected: number;
  /** the whole answer was not usable JSON in the agreed format */
  unusable: boolean;
}

/** Reads the final message content of one call. Nothing else is looked at. */
export function parseChunk(content: string, chunk: Finding[]): ParsedChunk {
  const accepted = new Map<string, string>();
  const tables = chunk.map((f) => f.table);
  const byId = new Map(chunk.map((f) => [f.id, f]));
  const unusable = { accepted, rejected: chunk.length, unusable: true };

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return unusable;
  }
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    !Array.isArray((data as { items?: unknown }).items)
  ) {
    return unusable;
  }

  const seen = new Set<string>();
  const bad = new Set<string>();
  for (const item of (data as { items: unknown[] }).items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const { id, explanation, ...extra } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !byId.has(id)) continue;
    if (seen.has(id)) {
      bad.add(id);
      continue;
    }
    seen.add(id);
    if (typeof explanation !== 'string' || Object.keys(extra).length > 0) {
      bad.add(id);
      continue;
    }
    const text = explanation.trim();
    if (checkExplanation(text, byId.get(id)!, tables) !== null) {
      bad.add(id);
      continue;
    }
    accepted.set(id, text);
  }
  // an id that appeared twice is not trusted at all
  for (const id of bad) accepted.delete(id);
  return { accepted, rejected: chunk.length - accepted.size, unusable: false };
}
