import type { CheckMode, Text } from './types.js';

/**
 * The Planner is plain code: this list decides which checks a run has.
 * No model decides it.
 */

/** Limits of the bundle scan (built in a later step). */
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
    limits: [
      {
        en: 'No active check is built yet.',
        ur: 'Abhi koi active check bana nahi.',
      },
    ],
  },
];
