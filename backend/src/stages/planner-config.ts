import { KEY_FORMATS_LIMIT } from './key-providers.js';
import type { CheckMode, Provided, Text } from './types.js';

/**
 * The Planner is plain code: this list decides which checks a run has.
 * No model decides it.
 */

/** How much of a site the bundle scan may read. */
export interface BundleScanLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

/** Limits of the bundle scan. */
export const BUNDLE_SCAN_LIMITS = {
  /** most script files that are read */
  maxFiles: 30,
  /** most bytes of ONE file, after decompression */
  maxFileBytes: 2 * 1024 * 1024,
  /** most bytes of all files together, after decompression */
  maxTotalBytes: 15 * 1024 * 1024,
} as const;

export interface CheckDefinition {
  id: string;
  title: Text;
  mode: CheckMode;
  required: boolean;
  /**
   * What the user must give for this check to run. A check whose input was not
   * given is planned as not required and shown as skipped ("not provided").
   * Missing = no input needed.
   */
  needs?: 'website' | 'supabase' | 'repo';
  /** What this check can not tell. Shown in the coverage. */
  limits: Text[];
}

export const NOT_IMPLEMENTED: Text = {
  en: 'Not implemented yet.',
  ur: 'Abhi bana nahi.',
};

export const ACTIVE_NOT_AVAILABLE: Text = {
  en: 'Not implemented yet. Active checks also need proven ownership of the site, and ownership is not checked yet.',
  ur: 'Abhi bana nahi. Active checks ke liye site ki malkiyat sabit karna bhi zaroori hai, aur malkiyat abhi check nahi hoti.',
};

const mb = (bytes: number) => bytes / (1024 * 1024);

export const CHECKS: CheckDefinition[] = [
  {
    id: 'data-access-prover',
    title: {
      en: 'Data access (can another user or a visitor reach a row?)',
      ur: 'Data access (kya doosra user ya visitor kisi row tak pahunch sakta hai?)',
    },
    mode: 'keyed',
    required: true,
    needs: 'supabase',
    limits: [
      {
        en: 'Only table data is tested: read, update and delete as another signed-in user, and read as a visitor. Tables without an owner column are reported as inconclusive.',
        ur: 'Sirf table ka data test hota hai: doosre login user ki tarah parhna, badalna, delete karna, aur visitor ki tarah parhna. Jis table mein owner column na ho wo inconclusive aata hai.',
      },
    ],
  },
  {
    id: 'tls-headers',
    title: {
      en: 'Certificate and security headers of the site',
      ur: 'Site ka certificate aur security headers',
    },
    mode: 'passive',
    required: true,
    needs: 'website',
    limits: [
      {
        en: 'Only the front page is read. Cookie settings, TLS versions and other pages are not checked.',
        ur: 'Sirf pehla page parha jata hai. Cookie settings, TLS versions aur doosre pages check nahi hote.',
      },
    ],
  },
  {
    id: 'bundle-secrets',
    title: {
      en: 'Secret keys inside the scripts of the site',
      ur: 'Site ki scripts ke andar chhupi hui secret keys',
    },
    mode: 'passive',
    required: true,
    needs: 'website',
    limits: [
      {
        en: `The bundle scan reads at most ${BUNDLE_SCAN_LIMITS.maxFiles} script files of the same origin, each at most ${mb(BUNDLE_SCAN_LIMITS.maxFileBytes)} MB after decompression and ${mb(BUNDLE_SCAN_LIMITS.maxTotalBytes)} MB in total. Scripts it could not read for these reasons are listed as not read.`,
        ur: `Bundle scan zyada se zyada ${BUNDLE_SCAN_LIMITS.maxFiles} same-origin script files parhta hai, har file decompress ke baad ${mb(BUNDLE_SCAN_LIMITS.maxFileBytes)} MB tak aur kul ${mb(BUNDLE_SCAN_LIMITS.maxTotalBytes)} MB. In wajah se jo scripts na parhi ja sakin unka naam "not read" mein aata hai.`,
      },
      {
        en: 'Scripts from other origins are not scanned.',
        ur: 'Doosre origin ki scripts scan nahi hotin.',
      },
      {
        en: 'A key that is found is reported as exposed. Whether it still works is not tested.',
        ur: 'Jo key milti hai use "exposed" likha jata hai. Wo ab bhi chalti hai ya nahi, ye test nahi hota.',
      },
    ],
  },
  {
    id: 'active-checks',
    title: {
      en: 'Active checks (probes sent to the site)',
      ur: 'Active checks (site par bheje gaye probes)',
    },
    mode: 'active',
    required: false,
    // no `needs`: what stops it is ownership, not a missing address
    limits: [
      {
        en: 'No active check is built yet.',
        ur: 'Abhi koi active check bana nahi.',
      },
    ],
  },
];

/**
 * Repo Scan Lite. It is NOT in CHECKS: a run without a repository has exactly
 * the checks it always had. `checksFor` adds it when a repository was given,
 * and then it is REQUIRED, like a website check whose address was given: a run
 * that was given a repository is not ready until the repository was read.
 */
export const REPO_CHECK_ID = 'repo-secrets';

export const REPO_CHECK: CheckDefinition = {
  id: REPO_CHECK_ID,
  title: {
    en: 'Secret keys inside the code of the GitHub repository',
    ur: 'GitHub repository ke code ke andar chhupi hui secret keys',
  },
  mode: 'passive',
  required: true,
  needs: 'repo',
  limits: [
    {
      en: 'Only a public GitHub repository is read, its default branch, as it is now. The history of old commits is not read.',
      ur: 'Sirf public GitHub repository parhi jati hai, uski default branch, jaisi abhi hai. Purane commits ki history nahi parhi jati.',
    },
    {
      en: 'Only text files are read (at most 1 MB each; the zip at most 15 MB, 40 MB unpacked, 3000 entries). Folders such as node_modules and dist are skipped, and so are files it could not read (they are listed as not read).',
      ur: 'Sirf text files parhi jati hain (har file 1 MB tak; zip 15 MB tak, unpack hone par 40 MB, 3000 entries). node_modules aur dist jaise folders chhod diye jate hain, aur jo files parhi na ja sakin unka naam "not read" mein aata hai.',
    },
    KEY_FORMATS_LIMIT,
    {
      en: 'A key found in a test path (a folder called test, tests, __tests__, fixtures, __mocks__ or e2e, or a file called *.test.* or *.spec.*) is only a warning sign (INCONCLUSIVE), because test files often hold fake values.',
      ur: 'Test path mein mili hui key (test, tests, __tests__, fixtures, __mocks__ ya e2e naam ka folder, ya *.test.* ya *.spec.* file) sirf khatre ki nishani hai (INCONCLUSIVE), kyunke test files mein aksar nakli values hoti hain.',
    },
    {
      en: 'A committed env file (.env, .env.local, .env.production, ...; not .env.example, .env.sample or .env.template) with a variable whose name says secret, password, token, API key or similar and that has a value is only a warning sign (INCONCLUSIVE). Only the names and the path are shown. Example values, very short values and numbers are skipped.',
      ur: 'Committed env file (.env, .env.local, .env.production, ...; .env.example, .env.sample ya .env.template nahi) jis mein aisi variable ho jis ka naam secret, password, token, API key waghaira kehta ho aur jis ki value likhi ho, sirf khatre ki nishani hai (INCONCLUSIVE). Sirf naam aur path dikhaye jate hain. Misal wali values, bahut chhoti values aur numbers chhod diye jate hain.',
    },
    {
      en: 'Variable names that start with NEXT_PUBLIC_ or VITE_ and say SECRET or SERVICE_ROLE are checked in UPPERCASE only (a lowercase name is not seen), and .md and .txt files are skipped for this.',
      ur: 'NEXT_PUBLIC_ ya VITE_ se shuru hone wale aur SECRET ya SERVICE_ROLE kehne wale variable naam sirf BADE (UPPERCASE) harfon mein check hote hain (chhote harf wala naam nazar nahi aata), aur is ke liye .md aur .txt files chhod di jati hain.',
    },
    {
      en: 'Migrations: only .sql files in any folder called migrations (at any depth, for example supabase/migrations or db/migrations) are read, and only tables of the public schema. CREATE TABLE in any letter case, UNLOGGED, IF NOT EXISTS, PARTITION OF, (LIKE ...) and CREATE TABLE AS are read as tables of their own; temporary tables are skipped. A table with no "enable row level security" in them is only a warning sign (INCONCLUSIVE): row level security may be enabled elsewhere, for example in the Supabase dashboard. Renamed tables and SQL that is built by code are not followed.',
      ur: 'Migrations: sirf kisi bhi "migrations" naam ke folder (kisi bhi gehrai par, maslan supabase/migrations ya db/migrations) ki .sql files parhi jati hain, aur sirf public schema ke tables. CREATE TABLE kisi bhi harf case mein, UNLOGGED, IF NOT EXISTS, PARTITION OF, (LIKE ...) aur CREATE TABLE AS har ek alag table maana jata hai; temporary tables chhod di jati hain. Jis table ke liye in mein "enable row level security" na ho wo sirf khatre ki nishani hai (INCONCLUSIVE): row level security kahin aur on ho sakti hai, maslan Supabase dashboard mein. Naam badle hue tables aur code se banayi gayi SQL follow nahi hoti.',
    },
    {
      en: 'A key that is found is reported as exposed. Whether it still works is not tested.',
      ur: 'Jo key milti hai use "exposed" likha jata hai. Wo ab bhi chalti hai ya nahi, ye test nahi hota.',
    },
  ],
};

/** The checks of a run: the fixed list, plus the repo check when a repository was given. */
export function checksFor(
  definitions: readonly CheckDefinition[],
  provided: Provided | undefined,
): readonly CheckDefinition[] {
  return provided?.repo === true &&
    !definitions.some((d) => d.id === REPO_CHECK_ID)
    ? [...definitions, REPO_CHECK]
    : definitions;
}

/** True when the input this check needs was given (or when nothing is known: the old behaviour). */
export function isProvided(
  definition: Pick<CheckDefinition, 'needs'>,
  provided: Provided | undefined,
): boolean {
  if (!definition.needs) return true;
  // The repo check exists only for a run that was given a repository.
  if (definition.needs === 'repo') return provided?.repo === true;
  if (!provided) return true;
  return definition.needs === 'website' ? provided.website : provided.supabase;
}

/** Why a check was not run because its input was not given. Names the check. */
export function notProvidedReason(
  definition: Pick<CheckDefinition, 'needs' | 'title'>,
): Text {
  if (definition.needs === 'repo') {
    return {
      en: `Not provided: no GitHub repository was given, so "${definition.title.en}" was not checked.`,
      ur: `Diya nahi gaya: GitHub repository nahi di gayi, isliye "${definition.title.ur}" check nahi hua.`,
    };
  }
  return definition.needs === 'supabase'
    ? {
        en: `Not provided: no Supabase details were given, so "${definition.title.en}" was not checked.`,
        ur: `Diya nahi gaya: Supabase ki details nahi di gayin, isliye "${definition.title.ur}" check nahi hua.`,
      }
    : {
        en: `Not provided: no website address was given, so "${definition.title.en}" was not checked.`,
        ur: `Diya nahi gaya: website ka address nahi diya gaya, isliye "${definition.title.ur}" check nahi hua.`,
      };
}
