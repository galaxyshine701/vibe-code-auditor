// Names of checks, written by the UI from the check id, in both languages (R87).
// The UI never shows an API title (plan[].title, scope[].title): the title of
// "tls-headers" still has a word the UI does not use. An unknown id is shown as
// the id, so a new check never breaks the page (R72).

export type Lang = 'en' | 'ur';

const CHECK_LABELS: Record<string, Record<Lang, string>> = {
  'data-access-prover': {
    en: 'Table data access',
    ur: 'Table data ka access',
  },
  'tls-headers': {
    en: 'Website headers and HTTPS',
    ur: 'Website ke headers aur HTTPS',
  },
  'bundle-secrets': {
    en: "Secret keys in the site's scripts",
    ur: 'Site ki scripts mein secret keys',
  },
  'active-checks': {
    en: 'Active checks (not built yet)',
    ur: 'Active checks (abhi bane nahi)',
  },
};

/** The label of a check, or the id itself when the UI does not know it. */
export function checkLabel(id: string, lang: Lang): string {
  return CHECK_LABELS[id]?.[lang] ?? id;
}

export function isKnownCheck(id: string): boolean {
  return id in CHECK_LABELS;
}

// What a site-headers item is about (R79). These are the names of the headers.
const SUBJECT_LABELS: Record<string, Record<Lang, string>> = {
  https: { en: 'HTTPS', ur: 'HTTPS' },
  'strict-transport-security': {
    en: 'Strict-Transport-Security (HSTS)',
    ur: 'Strict-Transport-Security (HSTS)',
  },
  'content-security-policy': {
    en: 'Content-Security-Policy',
    ur: 'Content-Security-Policy',
  },
  'x-content-type-options': {
    en: 'X-Content-Type-Options',
    ur: 'X-Content-Type-Options',
  },
  framing: { en: 'Framing rules', ur: 'Framing ke rules' },
  'referrer-policy': { en: 'Referrer-Policy', ur: 'Referrer-Policy' },
};

/** A subject the UI does not know (a script as host/path, a new header) is shown as given. */
export function subjectLabel(subject: string, lang: Lang): string {
  return SUBJECT_LABELS[subject]?.[lang] ?? subject;
}
