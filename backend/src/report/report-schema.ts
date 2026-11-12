import type { Verdict } from '../prover/types.js';

/** The only four texts the AI may write. Everything else comes from the Prover. */
export interface ReportText {
  title: string;
  explanationEn: string;
  explanationUr: string;
  fixDescription: string;
}

export const REPORT_LIMITS = {
  title: { min: 8, max: 90 },
  explanationEn: { min: 30, max: 400 },
  explanationUr: { min: 30, max: 400 },
  fixDescription: { min: 20, max: 300 },
} as const;

/** Sent to the provider. We check the limits ourselves too, because some providers ignore them. */
export const REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'explanationEn', 'explanationUr', 'fixDescription'],
  properties: {
    title: { type: 'string', maxLength: REPORT_LIMITS.title.max },
    explanationEn: {
      type: 'string',
      maxLength: REPORT_LIMITS.explanationEn.max,
    },
    explanationUr: {
      type: 'string',
      maxLength: REPORT_LIMITS.explanationUr.max,
    },
    fixDescription: {
      type: 'string',
      maxLength: REPORT_LIMITS.fixDescription.max,
    },
  },
} as const;

/** Fixed reason codes. A reason never quotes the AI's text. */
export type RejectReason =
  | 'not-json'
  | 'shape'
  | 'length'
  | 'script'
  | 'unsafe-text'
  | 'forbidden-claim'
  | 'contradicts-verdict';

export type ParseResult =
  { ok: true; value: ReportText } | { ok: false; reason: RejectReason };

const KEYS = [
  'title',
  'explanationEn',
  'explanationUr',
  'fixDescription',
] as const;

/** Whole phrases that must not appear (unless negated, see below). */
const FORBIDDEN_PHRASES = [
  'is secure',
  'is safe',
  'fully protected',
  'guaranteed',
  'certificate of security',
];

/** Words that turn a claim around: "not guaranteed", "nothing was leaked". */
const NEGATORS = new Set([
  'no',
  'not',
  'nothing',
  'without',
  // Roman Urdu: "nahi", "bina"
  'nahi',
  'nahin',
  'bina',
]);

/** Arabic / Urdu script. The Urdu text must be Roman Urdu (Latin letters). */
const NON_LATIN_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const UNSAFE_TEXT =
  /```|`|<|>|https?:|www\.|eyJ|sb_secret|sb_publishable|service_role|gsk_|AIza|\b(?:alter\s+table|create\s+policy|drop\s+(?:table|policy|schema))\b/i;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when one of the `before` words before the match, or one of the `after`
 * words after it, is a negator. Only the same sentence counts.
 */
function negatedNear(
  text: string,
  start: number,
  end: number,
  negators: ReadonlySet<string>,
  before: number,
  after: number,
  contractions: boolean,
): boolean {
  const head = text.slice(0, start);
  const sentenceStart =
    Math.max(
      head.lastIndexOf('.'),
      head.lastIndexOf('!'),
      head.lastIndexOf('?'),
      head.lastIndexOf(';'),
      head.lastIndexOf(':'),
      head.lastIndexOf('\n'),
    ) + 1;
  const tail = text.slice(end);
  const stop = tail.search(/[.!?;:\n]/);
  const words = (part: string) => part.toLowerCase().match(/[a-z']+/g) ?? [];
  const near = [
    ...(before > 0 ? words(head.slice(sentenceStart)).slice(-before) : []),
    ...words(stop === -1 ? tail : tail.slice(0, stop)).slice(0, after),
  ];
  return near.some(
    (word) => negators.has(word) || (contractions && word.endsWith("n't")),
  );
}

/** True when `phrase` appears at least once WITHOUT a negator just before it. */
export function hasUnnegated(text: string, phrase: string): boolean {
  const pattern = new RegExp(
    `\\b${escapeRegex(phrase).replace(/ /g, '\\s+')}\\b`,
    'gi',
  );
  for (const match of text.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (!negatedNear(text, match.index, end, NEGATORS, 3, 0, true)) {
      return true;
    }
  }
  return false;
}

/** Roman Urdu: "nahi" and "bina" come before OR after the claim ("secure nahi hai"). */
const URDU_NEGATORS = new Set(['nahi', 'nahin', 'bina']);

/**
 * Roman Urdu claims, as stems so spelling variants are caught:
 * secure, safe, mehfooz / mahfuz / mehfuz ..., surakshit, "bilkul theek", guarantee.
 */
const URDU_CLAIMS = [
  /\bsecure[d]?\b/gi,
  /\bsafe\b/gi,
  /\bm[ae]h?f[ou]+z\b/gi,
  /\bsurakshit\b/gi,
  /\bbilkul\s+theek\b/gi,
  /\bguarantee[d]?\b/gi,
];

/** Roman Urdu "a leak happened": "leak ho gaya / gayi / gaye / chuka", "leak hua / hui / hue". */
const URDU_LEAK_HAPPENED =
  /\bleak\s+(?:ho\s+(?:gaya|gayi|gaye|chuka|chuki|chuke)|hua|hui|hue)\b/gi;

/** True when the pattern appears at least once WITHOUT a negator within 3 words on either side. */
export function hasUnnegatedUrdu(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (!negatedNear(text, match.index, end, URDU_NEGATORS, 3, 3, false)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks the AI's answer. Anything doubtful is rejected, and the caller then
 * keeps the Prover's own text. The verdict is not part of the answer at all:
 * an answer with an extra field (for example "verdict") is rejected.
 */
export function parseReport(
  raw: string,
  context: { verdict: Verdict; hasFix: boolean },
): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'shape' };
  }
  const object = data as Record<string, unknown>;
  const names = Object.keys(object);
  if (
    names.length !== KEYS.length ||
    !KEYS.every((key) => typeof object[key] === 'string')
  ) {
    return { ok: false, reason: 'shape' };
  }

  const value = {} as ReportText;
  for (const key of KEYS) {
    value[key] = (object[key] as string).trim().replace(/[ \t]+/g, ' ');
  }
  if (!context.hasFix) value.fixDescription = '';

  for (const key of KEYS) {
    if (key === 'fixDescription' && !context.hasFix) continue;
    const { min, max } = REPORT_LIMITS[key];
    if (value[key].length < min || value[key].length > max) {
      return { ok: false, reason: 'length' };
    }
  }

  const texts = KEYS.map((key) => value[key]);
  if (texts.some((t) => NON_LATIN_SCRIPT.test(t))) {
    return { ok: false, reason: 'script' };
  }
  if (texts.some((t) => CONTROL_CHARS.test(t) || UNSAFE_TEXT.test(t))) {
    return { ok: false, reason: 'unsafe-text' };
  }
  if (texts.some((t) => FORBIDDEN_PHRASES.some((p) => hasUnnegated(t, p)))) {
    return { ok: false, reason: 'forbidden-claim' };
  }
  if (URDU_CLAIMS.some((p) => hasUnnegatedUrdu(value.explanationUr, p))) {
    return { ok: false, reason: 'forbidden-claim' };
  }
  if (context.verdict === 'LEAKED') {
    if (texts.some((t) => /\bno\s+leak\s+found\b/i.test(t))) {
      return { ok: false, reason: 'contradicts-verdict' };
    }
  } else if (
    texts.some((t) => hasUnnegated(t, 'leaked')) ||
    hasUnnegatedUrdu(value.explanationUr, URDU_LEAK_HAPPENED)
  ) {
    return { ok: false, reason: 'contradicts-verdict' };
  }
  return { ok: true, value };
}
