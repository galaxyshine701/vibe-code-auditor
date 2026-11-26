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

/** The small label above the headline. */
export const KICKER: Pair = {
  en: 'Checks for apps built with AI tools',
  ur: 'AI tools se bani apps ke liye checks',
};

/** The button under the example result that plays the intro again. */
export const REPLAY: Pair = {
  en: 'Replay intro',
  ur: 'Intro dobara chalayein',
};

/** The theme button of the header: the word on it, and what a screen reader says. */
export const THEME = {
  light: {
    word: { en: 'Light', ur: 'Roshan' },
    action: { en: 'Switch to light theme', ur: 'Roshan theme lagayein' },
  },
  dark: {
    word: { en: 'Dark', ur: 'Andhera' },
    action: { en: 'Switch to dark theme', ur: 'Andhera theme lagayein' },
  },
} as const;

/** The one line under the headline: the problem, in one plain sentence, no figures. */
export const PROBLEM: Pair = {
  en: 'An app built with AI tools can go live with its database or keys open to anyone.',
  ur: 'AI tools se bani app is halat mein live ho sakti hai ke uska database ya keys kisi ke liye bhi khuli hon.',
};

/**
 * The example result: a repository first, the way the home page asks for it.
 * The paths of the key and of the migration are the ones of the repo-only
 * example bundle (docs/frontend-mock/repo-only; a test compares them); the env
 * file and the two headers are made up. It is an example, and the card says so.
 * An env file shows the names of its variables and its path, never a value.
 */
export const CARD = {
  tag: {
    en: 'Example result, not a real audit',
    ur: 'Misaal ka nateeja, asli audit nahi',
  },
  tagNote: { en: 'Made-up app', ur: 'Farzi app' },
  scanning: { en: 'Scanning', ur: 'Jaanch jari' },
  keyFile: {
    label: { en: 'Secret key in a file', ur: 'File mein secret key' },
    detail: {
      en: 'A secret key is in a file of the repository',
      ur: 'Repository ki ek file mein secret key hai',
    },
    path: 'src/lib/supabase.ts:3',
    /** masked: the dots hide it, and it is never a real key */
    key: 'sb_secret_••••',
  },
  envFile: {
    label: { en: 'Committed .env file', ur: 'Commit ki hui .env file' },
    detail: {
      en: 'Secret-looking names with a value. The values were not checked.',
      ur: 'Secret jaise naam jin ki value likhi hai. Values check nahi huin.',
    },
    path: '.env',
    /** names only, never a value */
    names: 'JWT_SECRET, DB_PASSWORD',
  },
  migration: {
    label: {
      en: 'Migration without row level security',
      ur: 'Row level security ke baghair migration',
    },
    detail: {
      en: 'The table "orders" has none in the migrations (it may be enabled elsewhere)',
      ur: 'Migrations mein table "orders" ki nahi hai (kahin aur on ho sakti hai)',
    },
    path: 'supabase/migrations/001_init.sql:2',
  },
  headers: {
    label: { en: 'Site headers', ur: 'Site ke headers' },
    detail: { en: '2 of 6 headers are missing or weak', ur: '6 mein se 2 headers nahi hain ya kamzor hain' },
    result: { en: '2 missing', ur: '2 nahi hain' },
  },
  gate: {
    label: { en: 'Not ready by these checks', ur: 'In checks ke hisaab se abhi tayyar nahi' },
    reason: {
      en: 'A secret key is in a file of the repository.',
      ur: 'Repository ki ek file mein secret key hai.',
    },
    notProvided: {
      en: 'Not provided: Supabase test project',
      ur: 'Diya nahi gaya: Supabase test project',
    },
  },
} as const;

/**
 * The scene at the right of the hero: a test marker on a checkpoint post
 * (INCONCLUSIVE), an attempt stopped at a striped barrier (BLOCKED), and an app
 * with a key left in the open (LEAKED). It is a picture of the three words, not
 * a real audit, and the line under it says so (SCENE_NOTE).
 */
export const SCENE_NOTE: Pair = {
  en: 'Example scene, not a real audit',
  ur: 'Misaal ka manzar, asli audit nahi',
};

export const SCENE = {
  label: {
    en: 'Example scene: a test marker on a post, an attempt stopped at a barrier, a key left in the open in a window of an app',
    ur: 'Misaal ka manzar: post par test marker, barrier par ruki hui koshish, app ki khidki mein khuli reh gayi chabi',
  },
  marker: {
    title: { en: 'Test marker', ur: 'Test marker' },
    note: { en: 'a person should confirm', ur: 'insaan tasdeeq kare' },
    verdict: 'INCONCLUSIVE',
  },
  barrier: {
    title: { en: 'Attempt stopped', ur: 'Koshish ruk gayi' },
    note: { en: 'it did not get through', ur: 'aage nahi ja saki' },
    verdict: 'BLOCKED',
  },
  key: {
    title: { en: 'Key left open', ur: 'Chabi khuli reh gayi' },
    note: { en: 'anyone can read it', ur: 'koi bhi parh sakta hai' },
    verdict: 'LEAKED',
  },
} as const;

/**
 * The verdict tiles under the rows: how many of the example's verdict badges are
 * LEAKED and INCONCLUSIVE. A test counts the badges of the card, so these
 * numbers cannot drift from the rows.
 */
export const TILES = [
  { verdict: 'LEAKED', count: 1 },
  { verdict: 'INCONCLUSIVE', count: 2 },
] as const;

export const TILES_LABEL: Pair = {
  en: 'Verdicts of the example run',
  ur: 'Misaal ke run ke verdicts',
};

/**
 * The strip under the hero. Each part of the "Not checked" line is a limit the
 * checks themselves report (backend/src/stages/planner-config.ts, sent with
 * every report as coverage limits): `limit` quotes the words it comes from, and
 * a test looks for them there. Nothing else may be added to the line.
 */
export const WHAT_IT_CHECKS = {
  items: [
    {
      icon: 'files',
      title: { en: 'Secret keys in files', ur: 'Files mein secret keys' },
      body: {
        en: 'Known key formats, such as Supabase, OpenAI, Stripe and AWS.',
        ur: 'Jaani pehchani keys, maslan Supabase, OpenAI, Stripe aur AWS.',
      },
      reads: { en: 'reads: repo text files', ur: 'parhta hai: repo ki text files' },
    },
    {
      icon: 'env',
      title: { en: 'Committed .env files', ur: 'Commit ki hui .env files' },
      body: {
        en: 'Secret-looking names that have a value, as a warning sign.',
        ur: 'Secret jaise naam jin ki value likhi hai, khatre ki nishani ke taur par.',
      },
      reads: { en: 'reads: .env files in the repo', ur: 'parhta hai: repo ki .env files' },
    },
    {
      icon: 'migrations',
      title: {
        en: 'Database rules (RLS) in migrations',
        ur: 'Migrations mein database rules (RLS)',
      },
      body: {
        en: 'A table with no row level security there is a warning sign.',
        ur: 'Jis table ki row level security wahan na ho wo khatre ki nishani hai.',
      },
      reads: { en: 'reads: .sql files in migrations folders', ur: 'parhta hai: migrations folders ki .sql files' },
    },
    {
      icon: 'site',
      title: {
        en: 'Site headers and keys in site scripts',
        ur: 'Site ke headers aur scripts mein keys',
      },
      body: {
        en: 'For a live website: weak or missing headers, and keys in its scripts.',
        ur: 'Live website ke liye: kamzor ya ghayab headers, aur scripts mein keys.',
      },
      reads: { en: 'reads: front page and its own scripts', ur: 'parhta hai: pehla page aur us ki apni scripts' },
    },
  ],
  notCheckedLead: {
    en: 'Not checked by these checks:',
    ur: 'In checks mein check nahi hota:',
  },
  notChecked: [
    {
      en: 'private repos',
      ur: 'private repos',
      limit: 'Only a public GitHub repository is read',
    },
    {
      en: 'other branches and old commits',
      ur: 'doosri branches aur purane commits',
      limit: 'its default branch, as it is now. The history of old commits is not read',
    },
    {
      en: 'files over 1 MB and folders such as node_modules and dist',
      ur: '1 MB se bari files aur node_modules, dist jaise folders',
      limit: 'at most 1 MB each',
    },
    {
      en: 'whether a found key still works',
      ur: 'mili hui key ab bhi chalti hai ya nahi',
      limit: 'Whether it still works is not tested',
    },
    {
      en: 'website pages other than the front page (for headers)',
      ur: 'pehle page ke ilawa website ke pages (headers ke liye)',
      limit: 'Only the front page is read',
    },
    {
      en: 'cookie settings and TLS versions',
      ur: 'cookie settings aur TLS versions',
      limit: 'Cookie settings, TLS versions and other pages are not checked',
    },
    {
      en: 'scripts from other origins',
      ur: 'doosre origin ki scripts',
      limit: 'Scripts from other origins are not scanned',
    },
    {
      en: 'active probes sent to your site',
      ur: 'aap ki site par bheje jane wale active probes',
      limit: 'No active check is built yet',
    },
  ],
} as const;

export const STEPS = [
  {
    visual: 'paste',
    title: { en: 'Paste your repo link', ur: 'Repo ka link paste karein' },
    body: {
      en: 'Paste the link of a public GitHub repo and tick the box. A live website is optional.',
      ur: 'Public GitHub repo ka link paste karein aur box tick karein. Live website optional hai.',
    },
  },
  {
    visual: 'run',
    title: { en: 'Checks run', ur: 'Checks chalte hain' },
    body: {
      en: 'Each check runs on its own and keeps its evidence. You can follow it on the run page.',
      ur: 'Har check alag chalta hai aur apna saboot rakhta hai. Aap run page par dekh sakte hain.',
    },
  },
  {
    visual: 'result',
    title: { en: 'Read the result', ur: 'Nateeja parhein' },
    body: {
      en: 'A gate says ready or not by these checks, with the next steps and a fix prompt.',
      ur: 'Gate in checks ke hisaab se tayyar ya nahi batata hai, agle qadam aur fix prompt ke saath.',
    },
  },
] as const satisfies readonly { visual: string; title: Pair; body: Pair }[];

/** The headings of the sections of the home page: a small label, then the heading. */
export const SECTIONS = {
  checks: {
    label: { en: 'What it checks', ur: 'Ye kya check karta hai' },
    title: { en: 'Four things it reads', ur: 'Chaar cheezein jo ye parhta hai' },
  },
  how: {
    label: { en: 'How it works', ur: 'Ye kaise kaam karta hai' },
    title: { en: 'Three steps to a result', ur: 'Nateeje tak teen qadam' },
  },
  get: {
    label: { en: 'What you get', ur: 'Aap ko kya milta hai' },
    title: { en: 'A result you can act on', ur: 'Aisa nateeja jis par amal ho sake' },
  },
  words: {
    label: { en: 'What the words mean', ur: 'Lafzon ka matlab' },
    title: { en: 'Three words in every result', ur: 'Har nateeje ke teen lafz' },
  },
  advanced: {
    label: { en: 'Optional', ur: 'Optional' },
    title: { en: 'Check a Supabase test project too', ur: 'Supabase test project bhi check karein' },
  },
} as const;

/** "What you get": a short text and three points beside the example result. */
export const GET = {
  body: {
    en: 'One page with a gate result and the evidence behind it, in the order to work through.',
    ur: 'Ek page jis par gate ka nateeja aur us ka saboot hai, usi tarteeb mein jis mein kaam karna hai.',
  },
  points: [
    {
      en: 'A verdict, and where it was found',
      ur: 'Verdict, aur wo kahan mila',
    },
    {
      en: 'Why it matters, in plain words',
      ur: 'Ye kyun ahem hai, saade lafzon mein',
    },
    {
      en: 'A fix prompt in English and Roman Urdu',
      ur: 'Fix prompt English aur Roman Urdu mein',
    },
  ],
} as const;

/** The footer. */
export const FOOTER = {
  line: {
    en: 'launch readiness checks, by these checks only',
    ur: 'launch se pehle ke checks, sirf in checks ki had tak',
  },
  links: { en: 'Page links', ur: 'Page ke links' },
} as const satisfies Record<string, Pair>;

/** The words of the intro overlay. */
export const INTRO_COPY = {
  label: { en: 'Introduction', ur: 'Taaruf' },
  skip: { en: 'Skip intro', ur: 'Intro chhodein' },
  hint: {
    en: 'Tap, click or press Esc to skip.',
    ur: 'Chhorne ke liye tap ya click karein, ya Esc dabayein.',
  },
} as const satisfies Record<string, Pair>;

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
  cleanLead: { en: 'A clean result means', ur: 'Saaf nateeje ka matlab hai' },
  clean: {
    en: 'no leak found by these checks',
    ur: 'in checks mein koi leak nahi mila',
  },
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
