// The words of the home page's hero, in English and Roman Urdu: the headline,
// the problem line and the sub-line (the lede), the four lines of what it does,
// the four chips, the example run, the three steps and the one honesty line. They are here, not in the page, so a test can read them.
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

/** The first line of the lede: the problem, in one plain sentence, no figures. */
export const PROBLEM: Pair = {
  en: 'An app built with AI tools can go live with its database or keys open to anyone.',
  ur: 'AI tools se bani app is halat mein live ho sakti hai ke uska database ya keys kisi ke liye bhi khuli hon.',
};

/** The second line of the lede: what the tool is. The name is PROJECT_NAME. */
export function subLine(lang: Lang): string {
  return lang === 'ur'
    ? `${PROJECT_NAME} ek live site, ek Supabase project aur ek public GitHub repo ko check karta hai, phir in checks ke hisaab se ek gate result deta hai, saboot ke saath.`
    : `${PROJECT_NAME} checks a live site, a Supabase project and a public GitHub repo, then gives one gate result, by these checks, with the evidence.`;
}

/** What it does, in four short lines under the lede (website, Supabase, repo, gate). */
export const WHAT_IT_DOES = [
  {
    id: 'site',
    title: { en: 'Live site', ur: 'Live site' },
    body: {
      en: 'Reads the headers and the scripts that any visitor can read.',
      ur: 'Woh headers aur scripts parhta hai jo har visitor parh sakta hai.',
    },
  },
  {
    id: 'supabase',
    title: { en: 'Supabase tables', ur: 'Supabase tables' },
    body: {
      en: 'Replays two test users and a visitor against a canary row, to see if row level security (RLS) holds.',
      ur: 'Do test users aur ek visitor ko canary row par replay karta hai, taake pata chale ke row level security (RLS) qaim hai ya nahi.',
    },
  },
  {
    id: 'repo',
    title: { en: 'Public GitHub repo', ur: 'Public GitHub repo' },
    body: {
      en: 'Scans the files for secret keys, secret-looking public variable names, and tables with no RLS in the migrations.',
      ur: 'Files mein secret keys, secret jaisi public variable ke naam, aur migrations mein RLS ke baghair tables dhoondta hai.',
    },
  },
  {
    id: 'gate',
    title: { en: 'Gate', ur: 'Gate' },
    body: {
      en: 'Says ready or not ready, by these checks, with the evidence and the next steps in order.',
      ur: 'In checks ke hisaab se tayyar ya nahi batata hai, saboot aur agle qadam tarteeb se.',
    },
  },
] as const satisfies readonly { id: string; title: Pair; body: Pair }[];

/** The chips under the lede: the three groups of the Connect form, and all of them. */
export const CHIPS = [
  { id: 'website', label: { en: 'Website', ur: 'Website' } },
  { id: 'supabase', label: { en: 'Supabase', ur: 'Supabase' } },
  { id: 'repo', label: { en: 'GitHub repo', ur: 'GitHub repo' } },
  { id: 'all', label: { en: 'All', ur: 'Sab' } },
] as const satisfies readonly { id: string; label: Pair }[];

export type ChipId = (typeof CHIPS)[number]['id'];

/**
 * Where a chip points: the first field of its group (an element id of the
 * Connect form) and the group's place in the list of groups (website,
 * Supabase, repo). `null` = every group.
 */
export const CHIP_TARGET: Record<ChipId, { field: string; group: number | null }> = {
  website: { field: 'website-url', group: 0 },
  supabase: { field: 'project-url', group: 1 },
  repo: { field: 'repo-url', group: 2 },
  all: { field: 'website-url', group: null },
};

/** The example run. The numbers are an example, and the card says so. */
export const CARD = {
  tag: { en: 'Example, not a real audit', ur: 'Misaal, asli audit nahi' },
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
  repo: {
    label: { en: 'Repository files', ur: 'Repository ki files' },
    detail: {
      en: 'A table has no row level security in the migrations (it may be enabled elsewhere)',
      ur: 'Migrations mein ek table ki row level security nahi hai (kahin aur on ho sakti hai)',
    },
    result: { en: 'INCONCLUSIVE', ur: 'INCONCLUSIVE' },
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
      en: 'Add a website address, Supabase details, a public GitHub repo, or any of them together.',
      ur: 'Website address, Supabase ki details, public GitHub repo, ya in mein se kuch bhi saath dein.',
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
