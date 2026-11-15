/**
 * The closed vocabulary of the sentence the AI writes (the first sentence of
 * an explanation). Any word outside it makes the text unusable, so a glued
 * word such as "Thetable" or "tableis" can never reach a report.
 *
 * The list is also printed into the prompt, so the AI is told the words it may
 * use. It is deliberately small: a sentence says what each actor was able to
 * do, or was blocked from doing, and nothing else.
 */

/** Actors and what they are called. */
const ACTORS = [
  'user',
  'users',
  'b',
  'visitor',
  'visitors',
  'anon',
  'anonymous',
  'owner',
  'owners',
  'own',
];

/** Every form of each verb that may be used. */
const VERBS: Record<string, string[]> = {
  read: ['read', 'reads', 'reading'],
  delete: ['delete', 'deletes', 'deleted', 'deleting'],
  update: ['update', 'updates', 'updated', 'updating'],
  change: ['change', 'changes', 'changed', 'changing'],
  access: ['access', 'accesses', 'accessed', 'accessing'],
  see: ['see', 'sees', 'saw', 'seen', 'seeing'],
  return: ['return', 'returns', 'returned', 'returning'],
  check: ['check', 'checks', 'checked', 'checking'],
  verify: ['verify', 'verifies', 'verified', 'verifying'],
  block: ['block', 'blocks', 'blocked', 'blocking'],
  allow: ['allow', 'allows', 'allowed', 'allowing'],
};

/** Small common words. */
const COMMON = [
  'the',
  'a',
  'an',
  'and',
  'but',
  'while',
  'was',
  'were',
  'able',
  'to',
  'not',
  'no',
  'row',
  'rows',
  'data',
  'from',
  'of',
  'in',
  'its',
  'their',
  'could',
  'only',
  'also',
  'as',
  'expected',
];

/** Words added on top of the list above (small, and needed for ordinary sentences). */
const EXTRA = [
  'be',
  'is',
  'are',
  'it',
  'they',
  'that',
  'with',
  'on',
  'by',
  'for',
  'other',
  'second',
  'test',
  'both',
  'any',
  'all',
  'logged',
  'signed',
  'login',
  'without',
  'anything',
];

/** Only for INCONCLUSIVE: it must say the result cannot be trusted. */
const INCONCLUSIVE_ONLY = [
  'so',
  'because',
  'result',
  'results',
  'cannot',
  'can',
  'trusted',
  'did',
];

const BASE = new Set<string>([
  ...ACTORS,
  ...Object.values(VERBS).flat(),
  ...COMMON,
  ...EXTRA,
]);
const INCONCLUSIVE = new Set<string>([...BASE, ...INCONCLUSIVE_ONLY]);

/** The words that may be used for one verdict. */
export function allowedWords(verdict: string): ReadonlySet<string> {
  return verdict === 'INCONCLUSIVE' ? INCONCLUSIVE : BASE;
}

/**
 * The list as it is told to the AI (verbs by their base form). "normal" is the
 * list for every verdict; "inconclusive" is only the words added for INCONCLUSIVE.
 */
export function vocabularyForPrompt(which: 'normal' | 'inconclusive') {
  if (which === 'inconclusive') return INCONCLUSIVE_ONLY.join(', ');
  const words = [...ACTORS, ...Object.keys(VERBS), ...COMMON, ...EXTRA];
  return [...new Set(words)].join(', ');
}

/**
 * The words of a sentence that are not in the vocabulary. `'s` is dropped
 * ("owner's"), and an underscore or a hyphen separates words ("user_b").
 * Digits are allowed. Table names are removed before this is called.
 */
export function unknownWords(sentence: string, verdict: string): string[] {
  const allowed = allowedWords(verdict);
  const text = sentence
    .toLowerCase()
    .replace(/'s\b/g, '')
    .replace(/[_-]/g, ' ');
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  return tokens.filter((word) => !allowed.has(word) && !/^\d+$/.test(word));
}
