import { KEY_PROVIDERS, isSupabaseKind } from './key-providers.js';
import { scanForKeys, type KeyKind } from './site-rules.js';
import type { Text } from './types.js';

/**
 * "Fix prompt for your AI tool": a fixed text a person can paste into the AI
 * tool that built their app. Built from templates in code only (no AI model, no
 * time, no random): the same input always gives the same text.
 *
 * Rules, for every prompt:
 *  - English first, Roman Urdu as the second copy of the same prompt.
 *  - It always says: show the plan first, apply only after the person approves.
 *  - It never holds a key and never asks for one. The only values that go into
 *    a template are a table name, a file path, a script name or a header name.
 *    Each one is cleaned by `plain` (below), so a key that sits inside a name
 *    is replaced by a fixed word and never copied.
 */

/** Longest name (table, path, script) that goes into a prompt. */
const MAX_NAME = 120;
/** A run of this many letters, digits, "_" or "-" looks like a token, not a name. */
const TOKEN_RUN = 24;

/**
 * A name that is safe to put in a prompt: no query string, no line breaks or
 * quotes, not too long, and not shaped like a key. Anything else gives the
 * fallback word.
 */
export function plain(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  const cut = name.split(/[?#]/)[0].replace(/["'`\r\n\t]/g, ' ').trim();
  if (cut === '' || cut.length > MAX_NAME) return fallback;
  if (scanForKeys(cut).length > 0) return fallback;
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(cut)) return fallback;
  if (new RegExp(`[A-Za-z0-9_-]{${TOKEN_RUN},}`).test(cut)) return fallback;
  return cut;
}

const FOOTER: Text = {
  en: 'Show me the plan first: list every file and every change you will make, and wait. Apply nothing until I approve. Never print, ask for, or write any key or secret value.',
  ur: 'Pehle mujhe plan dikhao: har file aur har tabdeeli ki list do, aur ruko. Jab tak main approve na karun kuch apply mat karo. Koi key ya secret value kabhi print mat karo, na maango, na likho.',
};

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function build(en: string, ur: string): Text {
  return { en: `${en}\n\n${FOOTER.en}`, ur: `${ur}\n\n${FOOTER.ur}` };
}

/**
 * A leaked table. `hasOwnerColumn` = the audit found a column that says who
 * owns a row. Without one, the prompt does not guess: it asks the person who
 * should read and write the table.
 */
export function fixFindingPrompt(
  tableName: string | undefined,
  hasOwnerColumn: boolean,
): Text {
  const table = plain(tableName, 'this table');
  if (hasOwnerColumn) {
    return build(
      `In my Supabase project, the table "${table}" can be read or changed by users who do not own the rows. Turn on row level security for this table, and add policies so a signed-in user can only read, change and delete their own rows (use the owner column of the table). Write the change as a SQL migration for a TEST project first.`,
      `Mere Supabase project mein table "${table}" ki rows woh users bhi parh ya badal sakte hain jo un ke malik nahi. Is table par row level security on karo, aur aisi policies lagao ke signed-in user sirf apni rows parh, badal aur delete kar sake (table ka owner column use karo). Pehle TEST project ke liye ise SQL migration ki surat mein likho.`,
    );
  }
  return build(
    `In my Supabase project, the table "${table}" can be read or changed by users who do not own the rows. This table has no owner column that I know of. Before you write anything, ask me who should be allowed to read this table and who should be allowed to write to it (for example: only the signed-in owner, any signed-in user, or everyone). Then turn on row level security and propose policies for my answer.`,
    `Mere Supabase project mein table "${table}" ki rows woh users bhi parh ya badal sakte hain jo un ke malik nahi. Mujhe is table ka koi owner column nahi pata. Kuch likhne se pehle mujh se poochho ke is table ko kaun parh sakta hai aur kaun likh sakta hai (maslan: sirf signed-in malik, koi bhi signed-in user, ya sab). Phir row level security on karo aur mere jawab ke mutabiq policies batao.`,
  );
}

/** A secret key found in a script of the site. */
export function fixSiteSecretPrompt(
  scriptName: string | undefined,
  kind: KeyKind = 'secret-key',
): Text {
  const script = plain(scriptName, 'a script');
  if (!isSupabaseKind(kind)) {
    const { label, rotateWhere } = KEY_PROVIDERS[kind];
    return build(
      `${cap(label.en)} was found in the script "${script}" that my website sends to every visitor. Find where my code uses it. Move that work to server-side code (an API route or an edge function) so the browser never receives it, and read the key only from a server environment variable, never one that starts with NEXT_PUBLIC_ or VITE_. Remind me to rotate the key: ${rotateWhere.en}.`,
      `Mere website ke script "${script}" mein, jo har visitor ko jaata hai, ${label.ur} mili. Dhoondo ke mera code ise kahan use karta hai. Woh kaam server-side code (API route ya edge function) mein le jao taake browser ko woh kabhi na mile, aur key sirf server environment variable se parho, aisi variable se nahi jo NEXT_PUBLIC_ ya VITE_ se shuru ho. Mujhe yaad dilao ke key rotate karni hai: ${rotateWhere.ur}.`,
    );
  }
  return build(
    `A Supabase secret key was found in the script "${script}" that my website sends to every visitor. Find where my code uses the secret key. Move that work to server-side code (an API route or an edge function) so the browser never receives it. Read it only from a server environment variable, never one that starts with NEXT_PUBLIC_ or VITE_, and use only the publishable key in browser code. Remind me to rotate the key in the Supabase dashboard.`,
    `Mere website ke script "${script}" mein, jo har visitor ko jaata hai, Supabase secret key mili. Dhoondo ke mera code secret key kahan use karta hai. Woh kaam server-side code (API route ya edge function) mein le jao taake browser ko woh kabhi na mile. Use sirf server environment variable se parho, aisi variable se nahi jo NEXT_PUBLIC_ ya VITE_ se shuru ho, aur browser code mein sirf publishable key rakho. Mujhe yaad dilao ke Supabase dashboard mein key rotate karni hai.`,
  );
}

/** A secret key found in a file of the repository. */
export function fixRepoSecretPrompt(
  filePath: string | undefined,
  kind: KeyKind = 'secret-key',
): Text {
  const file = plain(filePath, 'a file');
  if (!isSupabaseKind(kind)) {
    const { label, rotateWhere } = KEY_PROVIDERS[kind];
    return build(
      `${cap(label.en)} was found in the file "${file}" of my repository. Take it out of that file and read it from an environment variable instead. Make sure the env files are listed in .gitignore. Remind me that the old commits keep the key, so I must rotate it: ${rotateWhere.en}.`,
      `Mere repository ki file "${file}" mein ${label.ur} mili. Use us file se nikalo aur uski jagah environment variable se parho. Dekho ke env files .gitignore mein hain. Mujhe yaad dilao ke purane commits mein key rehti hai, is liye mujhe use rotate karna hai: ${rotateWhere.ur}.`,
    );
  }
  return build(
    `A Supabase secret key was found in the file "${file}" of my repository. Take it out of that file and read it from an environment variable instead. Make sure the env files are listed in .gitignore. Remind me that the old commits keep the key, so I must rotate it in the Supabase dashboard.`,
    `Mere repository ki file "${file}" mein Supabase secret key mili. Use us file se nikalo aur uski jagah environment variable se parho. Dekho ke env files .gitignore mein hain. Mujhe yaad dilao ke purane commits mein key rehti hai, is liye mujhe Supabase dashboard mein use rotate karna hai.`,
  );
}

/** What to ask the AI tool for each header the audit can report. */
const HEADER_PROMPTS: Record<string, Text> = {
  https: {
    en: 'Make my website available only over https: turn on https at my host, and redirect every http address to https.',
    ur: 'Meri website sirf https par chale: host par https on karo, aur har http address ko https par redirect karo.',
  },
  'strict-transport-security': {
    en: 'Add the Strict-Transport-Security response header to my website, with a long max-age, so browsers keep using https.',
    ur: 'Meri website ke response mein Strict-Transport-Security header lagao, lambi max-age ke saath, taake browser https hi use karte rahein.',
  },
  'content-security-policy': {
    en: 'Add a Content-Security-Policy response header to my website. Start with a policy that allows only the scripts, styles and connections my site really uses.',
    ur: 'Meri website ke response mein Content-Security-Policy header lagao. Aisi policy se shuru karo jo sirf wohi scripts, styles aur connections allow kare jo meri site sach mein use karti hai.',
  },
  'x-content-type-options': {
    en: 'Add the response header "X-Content-Type-Options: nosniff" to my website.',
    ur: 'Meri website ke response mein header "X-Content-Type-Options: nosniff" lagao.',
  },
  framing: {
    en: 'Stop other sites from putting my website in a frame: add a frame-ancestors rule in the Content-Security-Policy header (or X-Frame-Options), allowing only my own site.',
    ur: 'Doosri sites meri website ko frame mein na daal sakein: Content-Security-Policy header mein frame-ancestors rule (ya X-Frame-Options) lagao, sirf meri apni site ko allow karke.',
  },
  'referrer-policy': {
    en: 'Add a Referrer-Policy response header to my website, for example "strict-origin-when-cross-origin".',
    ur: 'Meri website ke response mein Referrer-Policy header lagao, maslan "strict-origin-when-cross-origin".',
  },
};

/** A missing or weak header. A header the audit does not know gets no prompt. */
export function improveHeaderPrompt(header: string | undefined): Text | undefined {
  const base = HEADER_PROMPTS[header ?? ''];
  return base ? build(base.en, base.ur) : undefined;
}

/**
 * improve-repo has one template for each rule that can give such an item:
 *  - migration-rls: a "create table" with no "enable row level security" in
 *    the migrations (the audit could not tell if it is enabled elsewhere).
 *  - public-env-secret: a variable named NEXT_PUBLIC_ or VITE_ with SECRET or
 *    SERVICE_ROLE in its name (a browser build publishes it).
 */
/** A table name as SQL writes it: quoted when it is not a plain lowercase name. */
export function sqlName(table: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(table)
    ? table
    : `"${table.replace(/"/g, '""')}"`;
}

export type ImproveRepoRule =
  | 'migration-rls'
  | 'public-env-secret'
  | 'test-key'
  | 'committed-env';

export function improveRepoPrompt(
  rule: ImproveRepoRule,
  subject: string | undefined,
): Text {
  if (rule === 'migration-rls') {
    const table = plain(subject, 'this table');
    return build(
      `My repository has a migration that creates the table "${table}" but no migration that runs "enable row level security" for it. It may be turned on elsewhere (for example in the Supabase dashboard). First check the other migrations. If it is not turned on, add a new migration with "alter table public.${sqlName(table)} enable row level security", and show me the policies you propose before anything else.`,
      `Mere repository ki ek migration table "${table}" banati hai, lekin koi migration is ke liye "enable row level security" nahi chalati. Ho sakta hai woh kahin aur (maslan Supabase dashboard mein) on ho. Pehle baaki migrations dekho. Agar on nahi hai to nayi migration lagao jis mein "alter table public.${sqlName(table)} enable row level security" ho, aur sab se pehle mujhe woh policies dikhao jo tum suggest karte ho.`,
    );
  }
  if (rule === 'committed-env') {
    const file = plain(subject, 'an env file');
    return build(
      `The env file "${file}" is committed to my repository and holds variables that look like secrets. Remove the file from the repository (stop tracking it, but keep my local copy), add it to .gitignore, and keep a ".env.example" with the variable names and empty values instead. Remind me that the old commits still hold the values, so I must rotate every real secret that was in the file. Do not print the values.`,
      `Env file "${file}" mere repository mein commit hai aur isme secret jaisi variables hain. File ko repository se hatao (tracking band karo, lekin meri local copy rehne do), use .gitignore mein daalo, aur uski jagah ".env.example" rakho jis mein variables ke naam hon aur values khali. Mujhe yaad dilao ke purane commits mein values ab bhi hain, isliye file ki har asli secret mujhe rotate karni hai. Values print mat karo.`,
    );
  }
  if (rule === 'test-key') {
    const file = plain(subject, 'a test file');
    return build(
      `In the test file "${file}" of my repository there is a value that looks like a secret key. Find out whether it is a real key or a fake one made for the test. If it is real, take it out of the file, rotate it in the service that issued it, and read it from an environment variable that is not committed. If it is fake, change it to an obvious placeholder (for example "test-key-not-real") or build it inside the test from several parts, so that it no longer looks like a real key.`,
      `Mere repository ki test file "${file}" mein ek aisi value hai jo secret key jaisi lagti hai. Dekho ke ye asli key hai ya test ke liye banayi hui nakli. Agar asli hai to use file se nikalo, jis service ne di hai wahan rotate karo, aur aisi environment variable se parho jo commit na ho. Agar nakli hai to use saaf placeholder (maslan "test-key-not-real") bana do, ya test ke andar kai hisson se banao, taake wo asli key jaisi na lage.`,
    );
  }
  const file = plain(subject, 'a file');
  return build(
    `In the file "${file}" of my repository there is an environment variable whose name starts with NEXT_PUBLIC_ or VITE_ and holds the word SECRET or SERVICE_ROLE. Names like that are published to every visitor by the browser build. Check what the variable is for. If it holds a secret, rename it to a server-only name (without the NEXT_PUBLIC_ or VITE_ prefix) and move the code that uses it to the server. If it is not a secret, rename it so the name does not say so.`,
    `Mere repository ki file "${file}" mein ek environment variable hai jis ka naam NEXT_PUBLIC_ ya VITE_ se shuru hota hai aur jis mein SECRET ya SERVICE_ROLE likha hai. Aise naam browser build har visitor ko publish kar deta hai. Dekho ke yeh variable kis liye hai. Agar isme secret hai to use server-only naam do (NEXT_PUBLIC_ ya VITE_ ke baghair) aur use karne wala code server par le jao. Agar secret nahi hai to naam aisa rakho jo secret na kahe.`,
  );
}
