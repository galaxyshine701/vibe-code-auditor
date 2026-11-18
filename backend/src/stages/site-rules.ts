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

export type KeyKind = 'secret-key' | 'service-role-jwt';

const MAX_JWT_CHECKS = 200;

/**
 * Which kinds of Supabase secret are in this text: a new-style secret key
 * (sb_secret_...) or a JWT whose role is service_role. A publishable key and
 * an anon key are meant to be public and are not reported. Returns the KINDS,
 * each once, never the key.
 */
export function scanForKeys(text: string): KeyKind[] {
  const kinds = new Set<KeyKind>();
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) kinds.add('secret-key');
  let checked = 0;
  for (const match of text.matchAll(
    /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g,
  )) {
    if (++checked > MAX_JWT_CHECKS) break;
    try {
      const payload: unknown = JSON.parse(
        Buffer.from(match[1], 'base64url').toString('utf8'),
      );
      if (
        payload &&
        typeof payload === 'object' &&
        (payload as { role?: unknown }).role === 'service_role'
      ) {
        kinds.add('service-role-jwt');
      }
    } catch {
      // not a JWT after all
    }
  }
  return [...kinds];
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
