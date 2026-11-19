// The UI's own words of the Report of the agent pipeline, in English and Roman
// Urdu (R82). The words that come from the backend (gate reasons, coverage
// reasons, evidence summaries, roadmap texts) are shown as given; these are only
// the headings, labels and empty states.
//
// The rules of the words (R38, R87, R88): "by these checks", never "safe",
// "secure", "certified" or "guaranteed", no "MCP" or "Jira", and no "certificate".
// A test reads this file and every component for them.
import type { Lang } from './check-labels';

type Pair = { en: string; ur: string };

export const COPY = {
  // the gate banner (R77)
  gateReady: {
    en: 'No leak found by these checks.',
    ur: 'In checks se koi leak nahi mila.',
  },
  gateNotReady: {
    en: 'Not ready: see why',
    ur: 'Abhi tayyar nahi: wajah dekhein',
  },
  gateEyebrow: { en: 'Result by these checks', ur: 'In checks ka natija' },
  gateWhy: { en: 'Why', ur: 'Wajah' },

  // the summary (R80)
  summaryHeading: { en: 'Summary', ur: 'Khulasa' },
  summaryTables: { en: 'Tables', ur: 'Tables' },
  summarySite: { en: 'Website', ur: 'Website' },
  leaked: { en: 'Leaked', ur: 'Leak hue' },
  blocked: { en: 'Blocked', ur: 'Band' },
  inconclusive: { en: 'Inconclusive', ur: 'Faisla nahi' },
  siteKeys: { en: 'Secret keys in scripts', ur: 'Scripts mein secret keys' },
  siteHeaders: {
    en: 'Headers missing or weak',
    ur: 'Headers jo nahi hain ya kamzor hain',
  },
  notChecked: { en: 'not checked', ur: 'check nahi hua' },
  doThisFirst: { en: 'Do this first', ur: 'Pehle ye karein' },
  seeRoadmap: { en: 'All next steps', ur: 'Saare agle qadam' },

  // the scope (R78)
  scopeHeading: { en: 'What was checked', ur: 'Kya check hua' },
  scopeIntro: {
    en: 'Each check is in exactly one list.',
    ur: 'Har check sirf ek list mein hai.',
  },
  bucketChecked: { en: 'Checked', ur: 'Check hua' },
  bucketPartial: { en: 'Partly checked', ur: 'Adha check hua' },
  bucketNotProvided: { en: 'Not provided', ur: 'Diya nahi gaya' },
  bucketNotImplemented: { en: 'Not implemented yet', ur: 'Abhi bana nahi' },
  bucketFailed: { en: 'Failed to run', ur: 'Chala nahi' },
  bucketOutOfScope: { en: 'Left out on purpose', ur: 'Jaan kar chhoda gaya' },
  notRead: { en: 'Not read', ur: 'Parha nahi gaya' },
  required: { en: 'Required', ur: 'Zaroori' },
  addIt: { en: 'Add it with a new audit', ur: 'Naye audit mein shamil karein' },
  limitsHeading: { en: 'Limits of these checks', ur: 'In checks ki hadein' },
  emptyBucket: { en: 'Nothing here.', ur: 'Yahan kuch nahi.' },

  // the roadmap (R81)
  roadmapHeading: { en: 'Next steps', ur: 'Agle qadam' },
  roadmapIntro: {
    en: 'In the order to follow.',
    ur: 'Isi tarteeb se karein.',
  },
  roadmapEmpty: {
    en: 'No next steps from these checks.',
    ur: 'In checks se koi agla qadam nahi nikla.',
  },
  roadmapUnavailable: {
    en: 'The roadmap could not be made, so no steps are shown.',
    ur: 'Roadmap ban nahi saka, isliye qadam nahi dikhaye.',
  },
  requiredCheck: { en: 'Required check', ur: 'Zaroori check' },
  whyHeading: { en: 'Why', ur: 'Wajah' },
  stepsHeading: { en: 'Steps', ur: 'Qadam' },
  seeFinding: { en: 'See the finding', ur: 'Finding dekhein' },
  seeEvidence: { en: 'See the evidence', ur: 'Saboot dekhein' },

  // the evidence (R79)
  evidenceHeading: { en: 'Evidence', ur: 'Saboot' },
  evidenceEmpty: {
    en: 'No evidence items from these checks.',
    ur: 'In checks se koi saboot nahi nikla.',
  },
  kindTable: { en: 'Tables', ur: 'Tables' },
  kindHeaders: { en: 'Site headers', ur: 'Site ke headers' },
  kindBundle: { en: 'Scripts of the site', ur: 'Site ki scripts' },
  proofProven: { en: 'Proven', ur: 'Sabit' },
  proofUnverified: { en: 'Could not tell', ur: 'Pata nahi chal saka' },
  headerThere: { en: 'The header is there', ur: 'Header maujood hai' },
  headerWeak: { en: 'Missing or weak', ur: 'Nahi hai ya kamzor hai' },

  // empty and special states (R83)
  inviteWebsite: {
    en: 'Add a website address to check the site too.',
    ur: 'Site ko bhi check karne ke liye website address dein.',
  },
  inviteWebsiteBody: {
    en: 'This audit looked at Supabase only. The website checks were not provided.',
    ur: 'Is audit ne sirf Supabase dekha. Website ke checks diye nahi gaye.',
  },
  inviteSupabase: {
    en: 'Add Supabase details to check tables.',
    ur: 'Tables check karne ke liye Supabase ki details dein.',
  },
  noTables: {
    en: 'No Supabase details were given, so no table was checked.',
    ur: 'Supabase ki details nahi di gayin, isliye koi table check nahi hua.',
  },
  newAudit: { en: 'New audit', ur: 'Naya audit' },
  stageError: {
    en: 'Some parts of this report could not be read:',
    ur: 'Report ke kuch hisse parhe nahi ja sake:',
  },
  language: { en: 'Language', ur: 'Zabaan' },

  // the re-test result (R35, R74, R87)
  retestResult: { en: 'Re-test result', ur: 'Re-test ka natija' },
} as const satisfies Record<string, Pair>;

export type CopyKey = keyof typeof COPY;

export function t(lang: Lang, key: CopyKey): string {
  return COPY[key][lang];
}

/** "N more steps are not shown." (R81) */
export function moreSteps(count: number, lang: Lang): string {
  return lang === 'ur'
    ? `${count} aur qadam dikhaye nahi gaye.`
    : `${count} more ${count === 1 ? 'step is' : 'steps are'} not shown.`;
}
