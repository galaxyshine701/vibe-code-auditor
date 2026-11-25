// The words of the home page, in English and Roman Urdu: the headline, the one
// line under it, the start form, the example result, the three steps, the part
// "What this means", the Supabase section and the one honesty line. They are
// here, not in the page, so a test can read them.
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

/** The one line under the headline: the problem, in one plain sentence, no figures. */
export const PROBLEM: Pair = {
  en: 'An app built with AI tools can go live with its database or keys open to anyone.',
  ur: 'AI tools se bani app is halat mein live ho sakti hai ke uska database ya keys kisi ke liye bhi khuli hon.',
};

/** The example run. The numbers are an example, and the card says so. */
export const CARD = {
  tag: {
    en: 'Example result, not a real audit',
    ur: 'Misaal ka nateeja, asli audit nahi',
  },
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

/**
 * The scene above the rows of the example run: a canary on a checkpoint post, a
 * stranger stopped at a striped barrier (BLOCKED), and an app being built with a
 * key left in a window (LEAKED). It is a picture of the idea, not a real audit,
 * and the card around it says so (CARD.tag).
 */
export const SCENE = {
  label: {
    en: 'Example scene: a canary on a post, a stranger stopped at a barrier, a key left in a window of an app',
    ur: 'Misaal ka manzar: post par canary, barrier par ruka hua ajnabi, app ki khidki mein chhoti hui key',
  },
  canary: {
    title: { en: 'Canary row', ur: 'Canary row' },
    note: { en: 'on a checkpoint post', ur: 'checkpoint post par' },
  },
  barrier: {
    title: { en: 'Stranger stopped', ur: 'Ajnabi ruk gaya' },
    verdict: 'BLOCKED',
  },
  key: {
    title: { en: 'Key in a window', ur: 'Khidki mein key' },
    verdict: 'LEAKED',
  },
} as const;

/**
 * The three verdict tiles under the rows: how many of the example's verdicts
 * are LEAKED, INCONCLUSIVE and BLOCKED. A test counts the verdict badges of
 * the card, so these numbers cannot drift from the rows.
 */
export const TILES = [
  { verdict: 'LEAKED', count: 1 },
  { verdict: 'INCONCLUSIVE', count: 1 },
  { verdict: 'BLOCKED', count: 1 },
] as const;

export const TILES_LABEL: Pair = {
  en: 'Verdicts of the example run',
  ur: 'Misaal ke run ke verdicts',
};

export const STEPS = [
  {
    title: { en: 'Connect', ur: 'Jodein' },
    body: {
      en: 'Paste the link of a public GitHub repo. You can add a live website too.',
      ur: 'Public GitHub repo ka link paste karein. Chahein to live website bhi jodein.',
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

/** The words of the start form around its fields. */
export const FORM = {
  start: { en: 'Start', ur: 'Shuru karein' },
  starting: { en: 'Starting…', ur: 'Shuru ho raha hai…' },
  addWebsite: {
    en: 'Also check a live website (optional)',
    ur: 'Live website bhi check karein (optional)',
  },
  noAi: {
    en: 'Repo and website checks use no AI. AI is used only to explain Supabase findings.',
    ur: 'Repo aur website ke checks mein AI use nahi hota. AI sirf Supabase ke nateejon ko samjhane ke liye use hota hai.',
  },
  needCode: {
    en: 'Enter the access code at the top of the page first.',
    ur: 'Pehle page ke upar access code likhein.',
  },
} as const satisfies Record<string, Pair>;

/** The small access-code bar of the header. */
export const ACCESS = {
  label: {
    en: 'Access code (given by the owner)',
    ur: 'Access code (owner deta hai)',
  },
  memory: {
    en: 'Kept in memory for this page only, never stored.',
    ur: 'Sirf is page ki memory mein rehta hai, kahin save nahi hota.',
  },
  held: {
    en: 'Access code held for this page only.',
    ur: 'Access code sirf is page ke liye rakha hai.',
  },
  change: { en: 'Change', ur: 'Badlein' },
} as const satisfies Record<string, Pair>;

/** The Supabase part, at the bottom of the page and closed at first. */
export const ADVANCED = {
  link: {
    en: 'Advanced: Supabase test project',
    ur: 'Advanced: Supabase test project',
  },
  groq: {
    en: 'Table names and check results (never keys) are sent to Groq to write the explanation.',
    ur: 'Table ke naam aur check ke nateeje (keys kabhi nahi) explanation likhne ke liye Groq ko bheje jate hain.',
  },
  keys: {
    en: 'Keys stay in memory only. They are cleared from the form after the server accepts the run. Refreshing the page clears the access code.',
    ur: 'Keys sirf memory mein rehti hain. Server run qabool kare to form se hata di jati hain. Page refresh karne se access code mit jata hai.',
  },
  back: {
    en: 'Go to the start button',
    ur: 'Start button par jayein',
  },
  howTitle: { en: 'How the table check works', ur: 'Table check kaise hota hai' },
} as const satisfies Record<string, Pair>;

export const TABLE_STEPS = [
  {
    title: { en: 'Two temporary users', ur: 'Do temporary users' },
    body: {
      en: 'The auditor signs up user A and user B in your project.',
      ur: 'Auditor aap ke project mein user A aur user B banata hai.',
    },
  },
  {
    title: { en: 'A canary row', ur: 'Ek canary row' },
    body: {
      en: 'User A owns a new row. User B and a visitor try to read, change and delete it.',
      ur: 'Nayi row user A ki hoti hai. User B aur ek visitor use parhne, badalne aur delete karne ki koshish karte hain.',
    },
  },
  {
    title: { en: 'Evidence you can check', ur: 'Saboot jo aap dekh sakein' },
    body: {
      en: 'Every finding shows what the API answered and a reproducer with placeholders.',
      ur: 'Har finding dikhati hai ke API ne kya jawab diya, aur placeholders wala dobara chalane ka tareeqa.',
    },
  },
] as const satisfies readonly { title: Pair; body: Pair }[];

/** "What this means": how to read a result. */
export const MEANING = {
  title: { en: 'What this means', ur: 'Is ka matlab' },
  cleanLead: { en: 'A clean result means', ur: 'Saaf nateeje ka matlab hai' },
  clean: {
    en: 'no leak found by these checks',
    ur: 'in checks mein koi leak nahi mila',
  },
  covers: { en: 'See what they cover.', ur: 'Dekhein ye kya cover karte hain.' },
  leaked: {
    word: { en: 'Leaked', ur: 'Leak hua' },
    body: {
      en: 'A check saw the problem directly.',
      ur: 'Check ne masla seedha dekha.',
    },
  },
  inconclusive: {
    word: { en: 'Inconclusive', ur: 'Faisla nahi' },
    body: {
      en: 'A person should look and confirm.',
      ur: 'Kisi insaan ko dekh kar tasdeeq karni chahiye.',
    },
  },
  blocked: {
    word: { en: 'Blocked', ur: 'Band' },
    body: {
      en: 'What that check tried did not get through.',
      ur: 'Us check ki koshish aage nahi ja saki.',
    },
  },
} as const;

export function pickText(pair: Pair, lang: Lang): string {
  return pair[lang];
}
