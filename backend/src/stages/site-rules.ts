/**
 * The fixed rules of the website inspectors. Plain functions on text: no
 * network, no model, no randomness. What a rule finds is a kind or a name,
 * never the text it found (a key is never copied anywhere).
 */

type Headers = Record<string, string | string[] | undefined>;

export interface HeaderObservation {
  /** The header (or "https" / "framing"), as the evidence item names it. */
  subject: string;
  ok: boolean;
  en: string;
  ur: string;
}

const HSTS_MIN_SECONDS = 15_552_000; // 180 days

function valueOf(headers: Headers, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value.join(', ') : (value ?? '')).trim();
}

/** The security headers of the front page, one observation per rule. */
export function analyzeHeaders(
  headers: Headers,
  finalUrl: string,
): HeaderObservation[] {
  let https = false;
  try {
    https = new URL(finalUrl).protocol === 'https:';
  } catch {
    https = false;
  }
  const hsts = valueOf(headers, 'strict-transport-security');
  const maxAge = /max-age\s*=\s*(\d+)/i.exec(hsts);
  const csp = valueOf(headers, 'content-security-policy');
  const nosniff = valueOf(headers, 'x-content-type-options').toLowerCase();
  const framing =
    valueOf(headers, 'x-frame-options') !== '' || /frame-ancestors/i.test(csp);
  const referrer = valueOf(headers, 'referrer-policy');

  return [
    {
      subject: 'https',
      ok: https,
      en: https
        ? 'The site is reached over https.'
        : 'The site was reached over plain http, so what visitors send and receive is not encrypted.',
      ur: https
        ? 'Site https par khulti hai.'
        : 'Site seedha http par khuli, isliye visitors jo bhejte aur parhte hain wo encrypt nahi hota.',
    },
    {
      subject: 'strict-transport-security',
      ok: maxAge !== null && Number(maxAge[1]) >= HSTS_MIN_SECONDS,
      en:
        maxAge !== null && Number(maxAge[1]) >= HSTS_MIN_SECONDS
          ? 'The Strict-Transport-Security header is set, so browsers keep to https.'
          : 'The Strict-Transport-Security header is missing or too weak, so a browser may still try plain http.',
      ur:
        maxAge !== null && Number(maxAge[1]) >= HSTS_MIN_SECONDS
          ? 'Strict-Transport-Security header laga hua hai, isliye browser https par hi rehta hai.'
          : 'Strict-Transport-Security header nahi hai ya bahut kamzor hai, isliye browser ab bhi seedha http aazma sakta hai.',
    },
    {
      subject: 'content-security-policy',
      ok: csp !== '',
      en:
        csp !== ''
          ? 'A Content-Security-Policy header is set.'
          : 'The Content-Security-Policy header is missing, so the browser has no rule about where scripts may come from.',
      ur:
        csp !== ''
          ? 'Content-Security-Policy header laga hua hai.'
          : 'Content-Security-Policy header nahi hai, isliye browser ke paas ye rule nahi ke scripts kahan se aa sakti hain.',
    },
    {
      subject: 'x-content-type-options',
      ok: nosniff === 'nosniff',
      en:
        nosniff === 'nosniff'
          ? 'The X-Content-Type-Options header is set to nosniff.'
          : 'The X-Content-Type-Options: nosniff header is missing.',
      ur:
        nosniff === 'nosniff'
          ? 'X-Content-Type-Options header nosniff par hai.'
          : 'X-Content-Type-Options: nosniff header nahi hai.',
    },
    {
      subject: 'framing',
      ok: framing,
      en: framing
        ? 'The page says who may show it inside a frame (X-Frame-Options or frame-ancestors).'
        : 'The page does not say who may show it inside a frame, so another site could frame it (X-Frame-Options or frame-ancestors is missing).',
      ur: framing
        ? 'Page batata hai ke use frame mein kaun dikha sakta hai (X-Frame-Options ya frame-ancestors).'
        : 'Page nahi batata ke use frame mein kaun dikha sakta hai, isliye koi doosri site use frame kar sakti hai (X-Frame-Options ya frame-ancestors nahi hai).',
    },
    {
      subject: 'referrer-policy',
      ok: referrer !== '',
      en:
        referrer !== ''
          ? 'A Referrer-Policy header is set.'
          : 'The Referrer-Policy header is missing.',
      ur:
        referrer !== ''
          ? 'Referrer-Policy header laga hua hai.'
          : 'Referrer-Policy header nahi hai.',
    },
  ];
}

function attribute(attributes: string, name: string): string | null {
  const found = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i',
  ).exec(attributes);
  if (!found) return null;
  return found[1] ?? found[2] ?? found[3] ?? '';
}

/**
 * The scripts a page loads: `<script src>` and the preload links of scripts
 * (what modern bundlers write), resolved against the page. Only http(s), each
 * address once (without its #hash). The text of inline scripts is returned
 * too. Broken html never throws.
 */
export function extractScriptUrls(
  html: string,
  base: string,
): { srcs: string[]; inline: string[] } {
  const srcs = new Set<string>();
  const inline: string[] = [];
  const add = (raw: string) => {
    if (raw.trim() === '') return;
    try {
      const url = new URL(raw.trim(), base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      url.hash = '';
      srcs.add(url.href);
    } catch {
      // not an address: ignored
    }
  };
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const src = attribute(match[1], 'src');
    if (src !== null) add(src);
    else if (match[2].trim() !== '') inline.push(match[2].trim());
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, 'rel') ?? '';
    const as = attribute(tag, 'as') ?? '';
    const href = attribute(tag, 'href');
    if (
      href !== null &&
      (/\bmodulepreload\b/i.test(rel) ||
        (/\bpreload\b/i.test(rel) && as.toLowerCase() === 'script'))
    ) {
      add(href);
    }
  }
  return { srcs: [...srcs], inline };
}

export type KeyKind =
  | 'secret-key'
  | 'service-role-jwt'
  | 'sk-key'
  | 'stripe-secret-key'
  | 'aws-access-key-id'
  | 'github-token'
  | 'slack-token'
  | 'sk-ant-key'
  | 'gsk-key';

const MAX_JWT_CHECKS = 200;

/** Not a key: an example, a filler or a run of one character. */
const PLACEHOLDER =
  /x{4,}|your[_-]|example|changeme|change[_-]me|placeholder|\.{3}|([A-Za-z0-9])\1{9,}/i;

/** True when a text that matched a key format is only an example. */
export function looksLikePlaceholder(token: string): boolean {
  return PLACEHOLDER.test(token);
}

interface TokenFormat {
  kind: KeyKind;
  /** a fixed prefix and a minimum length; never a loose pattern */
  pattern: RegExp;
  /** a further test on the matched text */
  accept?: (token: string) => boolean;
}

// A key must not be the tail of a longer word: it starts after a character that
// can not be part of one.
const START = '(?<![A-Za-z0-9_-])';

/** Real keys of this kind mix letters and digits; a long hyphenated word does not. */
const mixed = (token: string) =>
  /\d/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token);

/**
 * The formats of secret keys the audit looks for, in the order their kinds are
 * reported. Google keys (AIza...) and Stripe publishable keys (pk_...) are
 * meant to be public and are NOT here. The two Supabase JWT checks are below.
 */
const TOKEN_FORMATS: TokenFormat[] = [
  { kind: 'secret-key', pattern: /sb_secret_[A-Za-z0-9_-]{16,}/g },
  {
    kind: 'sk-key',
    pattern: new RegExp(`${START}sk-(?!ant-)[A-Za-z0-9_-]{32,}`, 'g'),
    accept: mixed,
  },
  {
    kind: 'stripe-secret-key',
    pattern: new RegExp(`${START}(?:sk|rk)_live_[A-Za-z0-9]{16,}`, 'g'),
  },
  {
    kind: 'aws-access-key-id',
    pattern: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  },
  {
    kind: 'github-token',
    pattern: new RegExp(
      `${START}(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})`,
      'g',
    ),
  },
  {
    kind: 'slack-token',
    pattern: new RegExp(`${START}xoxb-[0-9A-Za-z-]{24,}`, 'g'),
    accept: (token) => /\d/.test(token),
  },
  {
    kind: 'sk-ant-key',
    pattern: new RegExp(`${START}sk-ant-[A-Za-z0-9_-]{20,}`, 'g'),
  },
  {
    kind: 'gsk-key',
    pattern: new RegExp(`${START}gsk_[A-Za-z0-9]{40,}`, 'g'),
  },
];

const JWT_PATTERN =
  /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function isServiceRoleJwt(payloadPart: string): boolean {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    );
    return (
      !!payload &&
      typeof payload === 'object' &&
      (payload as { role?: unknown }).role === 'service_role'
    );
  } catch {
    return false; // not a JWT after all
  }
}

/** The first key of each kind in the text: its kind and where it starts. Never the key. */
function findKeys(text: string): { kind: KeyKind; index: number }[] {
  const found: { kind: KeyKind; index: number }[] = [];
  const first = (format: TokenFormat) => {
    for (const match of text.matchAll(format.pattern)) {
      if (looksLikePlaceholder(match[0])) continue;
      if (format.accept && !format.accept(match[0])) continue;
      return match.index;
    }
    return -1;
  };
  const supabase = TOKEN_FORMATS[0];
  const secret = first(supabase);
  if (secret !== -1) found.push({ kind: supabase.kind, index: secret });
  let checked = 0;
  for (const match of text.matchAll(JWT_PATTERN)) {
    if (++checked > MAX_JWT_CHECKS) break;
    if (isServiceRoleJwt(match[1])) {
      found.push({ kind: 'service-role-jwt', index: match.index });
      break;
    }
  }
  for (const format of TOKEN_FORMATS.slice(1)) {
    const index = first(format);
    if (index !== -1) found.push({ kind: format.kind, index });
  }
  return found;
}

/**
 * Which kinds of secret key are in this text: a Supabase secret key or
 * service_role JWT, or the secret key of another provider (see TOKEN_FORMATS).
 * A publishable key, an anon key and example values are not reported. Returns
 * the KINDS, each once, never the key.
 */
export function scanForKeys(text: string): KeyKind[] {
  return findKeys(text).map((hit) => hit.kind);
}

/**
 * Where the first key of each kind is in this text: the kind and the 1-based
 * line. Never the key itself. Same rules as scanForKeys.
 */
export function scanForKeyHits(
  text: string,
): { kind: KeyKind; line: number }[] {
  const lineOf = (index: number) => {
    let line = 1;
    for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) {
      line += 1;
    }
    return line;
  };
  return findKeys(text).map((hit) => ({ kind: hit.kind, line: lineOf(hit.index) }));
}

/** How a script is named in a result: host and path, never the query or the hash. */
export function scriptName(address: string): string {
  try {
    const url = new URL(address);
    return `${url.host}${url.pathname}`.slice(0, 120);
  } catch {
    return '(unreadable address)';
  }
}
