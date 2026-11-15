import type { Finding } from '../prover/types.js';
import { MAX_EXPLANATION_CHARS } from './limits.js';
import { unknownWords } from './report-vocabulary.js';

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

/** Typographic marks an AI often writes, with the plain ASCII mark for each. */
const PLAIN_MARKS: [RegExp, string][] = [
  [/[\u2018\u2019\u201a\u201b\u2032]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/\u2026/g, '...'],
];

/**
 * Makes the text plain before it is checked and before it is kept:
 * NFKC (so full-width letters become normal letters), typographic quotes and
 * dashes become ASCII, every space-like character (no-break space, narrow
 * space, thin space, ideographic space ...) becomes one normal space.
 * Anything that is still not plain ASCII (zero-width characters, letters of
 * another alphabet that only look like ours, symbols) means the text is not
 * used: it returns null. An invisible character could hide a banned word.
 */
export function sanitizeExplanation(text: string): string | null {
  let out = text.normalize('NFKC');
  for (const [pattern, plain] of PLAIN_MARKS) out = out.replace(pattern, plain);
  out = out
    .replace(/\p{Zs}/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return /[^\x20-\x7e]/.test(out) ? null : out;
}

/** Splits a text into sentences at . ! ? followed by a space. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((part) => part.trim() !== '');
}

export type TextProblem =
  | 'length'
  | 'shape'
  | 'characters'
  | 'sentences'
  | 'vocabulary'
  | 'inconclusive-word'
  | 'verdict-word'
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
  // Line breaks, tabs and other control characters are refused as they are.
  if (NOT_ALLOWED_SHAPE.some((pattern) => pattern.test(text))) return 'shape';
  const clean = sanitizeExplanation(text);
  if (clean === null) return 'characters';
  if (clean.length < 1 || clean.length > MAX_EXPLANATION_CHARS) return 'length';

  const stripped = removeTableNames(clean, tables);
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

  // Exactly two sentences. The second is the result for the app owner and
  // carries the verdict word, in capitals, as the Prover wrote it.
  const sentences = sentencesOf(clean);
  if (sentences.length !== 2) return 'sentences';
  if (!sentences[1].includes(finding.verdict)) return 'verdict-word';
  return null;
}

/** Words an INCONCLUSIVE sentence must not use: they would sound like a clear answer. */
const NOT_FOR_INCONCLUSIVE =
  /\b(?:block(?:ed|s|ing)?|denied|deny|denies|denying|protect(?:ed|s|ing|ion)?|safe|secure[ds]?)\b/i;

/**
 * Checks the one sentence the AI writes, before the program adds the result
 * sentence: only words of the closed vocabulary (table names are removed
 * first), plain punctuation, and for INCONCLUSIVE none of the words that
 * sound like a clear answer.
 */
export function checkSentence(
  sentence: string,
  finding: Pick<Finding, 'verdict'>,
  tables: string[],
): TextProblem | null {
  const stripped = removeTableNames(sentence, tables);
  if (
    finding.verdict === 'INCONCLUSIVE' &&
    NOT_FOR_INCONCLUSIVE.test(stripped)
  ) {
    return 'inconclusive-word';
  }
  if (/[^A-Za-z0-9 ,'_-]/.test(stripped)) return 'vocabulary';
  if (unknownWords(stripped, finding.verdict).length > 0) return 'vocabulary';
  return null;
}

/** The words outside the vocabulary, for the smoke script (never for logs). */
export function wordsOutsideVocabulary(
  sentence: string,
  finding: Pick<Finding, 'verdict'>,
  tables: string[],
): string[] {
  return unknownWords(removeTableNames(sentence, tables), finding.verdict);
}

/**
 * Makes the sentence of the AI into the whole explanation. The program, not
 * the AI, adds the second sentence with the verdict word.
 * Returns null when the AI wrote more than one sentence or nothing.
 */
export function composeExplanation(
  sentence: string,
  finding: Pick<Finding, 'verdict'>,
): string | null {
  const body = sentence.replace(/[.!?\s]+$/, '');
  if (body === '' || /[.!?]/.test(body)) return null;
  return `${body}. The table is ${finding.verdict}.`;
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
    const { id, sentence, ...extra } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !byId.has(id)) continue;
    if (seen.has(id)) {
      bad.add(id);
      continue;
    }
    seen.add(id);
    if (typeof sentence !== 'string' || Object.keys(extra).length > 0) {
      bad.add(id);
      continue;
    }
    const finding = byId.get(id)!;
    const clean = sanitizeExplanation(sentence);
    if (
      clean === null ||
      checkSentence(clean.replace(/[.!?\s]+$/, ''), finding, tables) !== null
    ) {
      bad.add(id);
      continue;
    }
    const composed = composeExplanation(clean, finding);
    // the checks of the whole text (two sentences, the verdict word, claims,
    // severity, soft words, the verdict) run on the text that is kept
    if (
      composed === null ||
      checkExplanation(composed, finding, tables) !== null
    ) {
      bad.add(id);
      continue;
    }
    accepted.set(id, composed);
  }
  // an id that appeared twice is not trusted at all
  for (const id of bad) accepted.delete(id);
  return { accepted, rejected: chunk.length - accepted.size, unusable: false };
}
