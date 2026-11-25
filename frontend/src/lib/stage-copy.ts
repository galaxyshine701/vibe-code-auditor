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
  summaryRepo: { en: 'Repository', ur: 'Repository' },
  repoKeys: { en: 'Secrets in repo', ur: 'Repo mein secrets' },
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

  // the fix prompt of a roadmap item
  fixPromptHeading: { en: 'Fix prompt for your AI tool', ur: 'Aapke AI tool ke liye fix prompt' },
  fixPromptHint: {
    en: 'Paste it into the AI tool that built your app. It shows the plan first and changes nothing until you approve.',
    ur: 'Ise us AI tool mein paste karein jis ne aapki app banayi. Woh pehle plan dikhata hai aur aap ke approve karne tak kuch nahi badalta.',
  },
  copyPrompt: { en: 'Copy', ur: 'Copy karein' },
  copiedPrompt: { en: 'Copied', ur: 'Copy ho gaya' },
  copyFailed: { en: 'Could not copy: select the text and copy it by hand.', ur: 'Copy nahi hua: text select karke haath se copy karein.' },

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
  kindRepo: { en: 'Repository files', ur: 'Repository ki files' },
  kindRepoMigration: { en: 'Repository migrations', ur: 'Repository ki migrations' },
  kindRepoTestKey: { en: 'Repository test files', ur: 'Repository ki test files' },
  kindRepoEnvFile: { en: 'Repository env files', ur: 'Repository ki env files' },
  kindRepoName: { en: 'Repository variable names', ur: 'Repository ki variable ke naam' },
  repoKeyHidden: {
    en: 'The key is hidden. Only its place is shown.',
    ur: 'Key chhupi hui hai. Sirf uski jagah dikhai gayi hai.',
  },
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

// What a roadmap item is about (R81). A kind the UI does not know is shown as given.
const KIND_LABELS: Record<string, Pair> = {
  'fix-finding': { en: 'Fix a table', ur: 'Table theek karein' },
  'fix-site-secret': { en: 'Remove a secret key', ur: 'Secret key hatayein' },
  'fix-repo-secret': {
    en: 'Remove a secret key from the repo',
    ur: 'Repo se secret key hatayein',
  },
  'improve-header': { en: 'Improve a header', ur: 'Header behtar karein' },
  'improve-repo': { en: 'Improve the repo', ur: 'Repo behtar karein' },
  confirm: { en: 'Confirm', ur: 'Tasdeeq karein' },
  cleanup: { en: 'Clean up', ur: 'Safai karein' },
  'finish-check': { en: 'Finish a check', ur: 'Check poora karein' },
  'provide-input': { en: 'Add input', ur: 'Input dein' },
  retest: { en: 'Re-test', ur: 'Re-test' },
};

export function kindLabel(kind: string, lang: Lang): string {
  return KIND_LABELS[kind]?.[lang] ?? kind;
}

/** "N more steps are not shown." (R81) */
export function moreSteps(count: number, lang: Lang): string {
  return lang === 'ur'
    ? `${count} aur qadam dikhaye nahi gaye.`
    : `${count} more ${count === 1 ? 'step is' : 'steps are'} not shown.`;
}

/** "N files read" next to the repository tile; only called with a number the API sent. */
export function filesReadText(count: number, lang: Lang): string {
  return lang === 'ur'
    ? `${count} files parhi gayin`
    : `${count} ${count === 1 ? 'file' : 'files'} read`;
}
