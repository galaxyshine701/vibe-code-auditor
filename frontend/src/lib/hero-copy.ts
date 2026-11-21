// The words of the home page's hero, in English and Roman Urdu: the headline,
// the sub-line, the three chips, the example run, the three steps and the one
// honesty line. They are here, not in the page, so a test can read them.
//
// Rules of the words (R38, R88): "by these checks", never "safe", "secure",
// "certified" or "guaranteed". The key in the example is masked (dots), never a
// real one. The product name is PROJECT_NAME.
import { PROJECT_NAME } from './brand';
import type { Lang } from './check-labels';

type Pair = { en: string; ur: string };

/** The headline. The English one has 8 words: its timing (the words come one after the other) is the same as before. */
export const HEADLINE: Pair = {
  en: 'Before you launch: what can a stranger reach?',
  ur: 'Launch se pehle: ek ajnabi aap ki app mein kahan tak pahunch sakta hai?',
};

export function headlineWords(lang: Lang): string[] {
  return HEADLINE[lang].split(' ');
}

export function subLine(lang: Lang): string {
  return lang === 'ur'
    ? `Website address, Supabase ki details, ya dono dein. ${PROJECT_NAME} dekhta hai ke visitor kya parh sakta hai aur doosra user kahan tak pahunchta hai, aur saboot dikhata hai.`
    : `Add a website address, Supabase details, or both. ${PROJECT_NAME} looks at what a visitor can read and what another user can reach, and shows the proof.`;
}

/** The three chips under the sub-line: the two groups of the Connect form, and both. */
export const CHIPS = [
  { id: 'website', label: { en: 'Website', ur: 'Website' } },
  { id: 'supabase', label: { en: 'Supabase', ur: 'Supabase' } },
  { id: 'both', label: { en: 'Both', ur: 'Dono' } },
] as const satisfies readonly { id: string; label: Pair }[];

export type ChipId = (typeof CHIPS)[number]['id'];

/** The example run. The numbers are an example, and the card says so. */
export const CARD = {
  tag: { en: 'Example run', ur: 'Misaal' },
  tagNote: { en: 'Made-up numbers', ur: 'Farzi ankre' },
  scanning: { en: 'Scanning', ur: 'Jaanch jari' },
  headers: {
    label: { en: 'Site headers', ur: 'Site ke headers' },
    detail: { en: '2 of 6 headers are missing or weak', ur: '6 mein se 2 headers nahi hain ya kamzor hain' },
    result: { en: '2 missing', ur: '2 nahi hain' },
  },
  scripts: {
    label: { en: 'Scripts of the site', ur: 'Site ki scripts' },
    detail: { en: 'A secret-looking key is in a script', ur: 'Ek script mein secret jaisi key hai' },
    /** masked: the dots hide it, and it is never a real key */
    key: 'sb_secret_••••',
    result: { en: 'LEAKED', ur: 'LEAKED' },
  },
  tables: {
    label: { en: 'Table data', ur: 'Table ka data' },
    detail: {
      en: 'Another user and a visitor could not reach the canary row',
      ur: 'Doosra user aur visitor canary row tak nahi pahunch sake',
    },
    result: { en: 'BLOCKED', ur: 'BLOCKED' },
  },
  gate: {
    label: { en: 'Not ready by these checks', ur: 'In checks ke hisaab se abhi tayyar nahi' },
    reason: {
      en: 'A secret key is in a script of the site.',
      ur: 'Site ki ek script mein secret key hai.',
    },
    notProvided: {
      en: 'Not provided: pages behind a login',
      ur: 'Diya nahi gaya: login wale pages',
    },
  },
  figure: {
    en: 'Owner A, User B and a visitor try to reach one canary row behind a policy',
    ur: 'Owner A, User B aur visitor ek canary row tak pahunchne ki koshish karte hain, jis ke aage policy hai',
  },
} as const;

export const STEPS = [
  {
    title: { en: 'Connect', ur: 'Jodein' },
    body: {
      en: 'Add a website address, Supabase details, or both.',
      ur: 'Website address, Supabase ki details, ya dono dein.',
    },
  },
  {
    title: { en: 'Checks run', ur: 'Checks chalte hain' },
    body: {
      en: 'Each check runs on its own and keeps its evidence.',
      ur: 'Har check alag chalta hai aur apna saboot rakhta hai.',
    },
  },
  {
    title: { en: 'Gate and roadmap', ur: 'Gate aur roadmap' },
    body: {
      en: 'A gate says ready or not by these checks, with the next steps in order.',
      ur: 'Gate in checks ke hisaab se tayyar ya nahi batata hai, agle qadam tarteeb se.',
    },
  },
] as const satisfies readonly { title: Pair; body: Pair }[];

export function honestyLine(lang: Lang): string {
  return lang === 'ur'
    ? `${PROJECT_NAME} sirf wohi checks chalata hai jo list mein hain, aur har report apna scope dikhati hai.`
    : `${PROJECT_NAME} only runs the listed checks, and every report shows its scope.`;
}

export function pickText(pair: Pair, lang: Lang): string {
  return pair[lang];
}
