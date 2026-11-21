import type { Finding, Severity } from '../prover/types.js';
import { CHECKS } from './planner-config.js';
import {
  fixFindingPrompt,
  fixRepoSecretPrompt,
  fixSiteSecretPrompt,
  improveHeaderPrompt,
  improveRepoPrompt,
  plain,
} from './fix-prompts.js';
import type {
  Coverage,
  EvidenceItem,
  PlannedCheck,
  Provided,
  Roadmap,
  RoadmapItem,
  RoadmapKind,
  Text,
} from './types.js';

/**
 * The Roadmap stage: what to do next, in order. Plain code. The same input
 * always gives the same roadmap: no time, no random, and the order of the
 * input lists does not matter. It READS the findings, the evidence and the
 * coverage and never changes them. It does not copy the Prover's SQL: a fix
 * item points at the finding that holds it.
 *
 * What does NOT get an item: a BLOCKED table or header, a check that is "not
 * implemented yet", and ownership.
 */

/** Most items in one roadmap. The rest is only counted (`truncated`). */
export const ROADMAP_CAP = 100;

/** The roadmap of a run that has none (the Roadmap step was not available). */
export const ROADMAP_UNAVAILABLE: Roadmap = {
  schemaVersion: 1,
  items: [],
  truncated: 0,
};

/** The order of kinds when severity and "required" are the same. */
export const KIND_RANK: readonly RoadmapKind[] = [
  'fix-site-secret',
  'fix-repo-secret',
  'fix-finding',
  'cleanup',
  'finish-check',
  'improve-header',
  'improve-repo',
  'confirm',
  'provide-input',
  'retest',
];

const SEVERITY_RANK: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

/** How many names of parts that were not read go into one sentence. */
const MAX_NAMES = 10;

export interface RoadmapInput {
  plan: readonly PlannedCheck[];
  findings: readonly Finding[];
  evidence: readonly EvidenceItem[];
  coverage: Coverage;
  cleanup: 'ok' | 'failed' | null;
  /** What the user gave. Missing = Supabase details were given. */
  provided?: Provided;
}

type Draft = Omit<RoadmapItem, 'id'>;

/** `fixPrompt` only when there is one (a key that is absent, not undefined). */
const fixPromptField = (text: Text | undefined) =>
  text ? { fixPrompt: text } : {};

const DATA_ACCESS = 'data-access-prover';
const HEADERS = 'tls-headers';
const BUNDLE = 'bundle-secrets';
const REPO = 'repo-secrets';

const isTable = (e: EvidenceItem) =>
  e.check === DATA_ACCESS && (e.kind === undefined || e.kind === 'table');

/** What to do about one missing or weak header. */
const HEADER_ADVICE: Record<
  string,
  { severity: Severity; title: Text; why: Text; steps: Text[] }
> = {
  https: {
    severity: 'high',
    title: {
      en: 'Serve the site over https',
      ur: 'Site ko https par chalayein',
    },
    why: {
      en: 'The site was reached over plain http, so what visitors send and receive is not encrypted.',
      ur: 'Site seedha http par khuli, isliye visitors jo bhejte aur parhte hain wo encrypt nahi hota.',
    },
    steps: [
      {
        en: 'Turn on https (a TLS certificate) at your host or domain provider.',
        ur: 'Apne host ya domain provider par https (TLS certificate) on karein.',
      },
      {
        en: 'Redirect every http address to its https address.',
        ur: 'Har http address ko uske https address par redirect karein.',
      },
    ],
  },
  'strict-transport-security': {
    severity: 'medium',
    title: {
      en: 'Add the Strict-Transport-Security header',
      ur: 'Strict-Transport-Security header lagayein',
    },
    why: {
      en: 'Without this header a browser may still try plain http for your site.',
      ur: 'Is header ke baghair browser ab bhi aapki site ke liye seedha http aazma sakta hai.',
    },
    steps: [
      {
        en: 'Send the header "Strict-Transport-Security: max-age=31536000; includeSubDomains" from your host or server.',
        ur: 'Apne host ya server se header "Strict-Transport-Security: max-age=31536000; includeSubDomains" bhejein.',
      },
      {
        en: 'Run the audit again to see the header.',
        ur: 'Header dekhne ke liye audit dobara chalayein.',
      },
    ],
  },
  'content-security-policy': {
    severity: 'medium',
    title: {
      en: 'Add a Content-Security-Policy header',
      ur: 'Content-Security-Policy header lagayein',
    },
    why: {
      en: 'The browser has no rule about where scripts may come from, so a script injected by someone else would run.',
      ur: 'Browser ke paas ye rule nahi ke scripts kahan se aa sakti hain, isliye kisi aur ki dali hui script chal jayegi.',
    },
    steps: [
      {
        en: 'Start with a simple policy such as "default-src \'self\'" and allow only the places your site really loads scripts from.',
        ur: 'Sada policy se shuru karein, jaise "default-src \'self\'", aur sirf wahi jagahein allow karein jahan se aapki site sach mein scripts leti hai.',
      },
      {
        en: 'Send it as the Content-Security-Policy header, test the site, then run the audit again.',
        ur: 'Ise Content-Security-Policy header ke taur par bhejein, site test karein, phir audit dobara chalayein.',
      },
    ],
  },
  'x-content-type-options': {
    severity: 'low',
    title: {
      en: 'Add the X-Content-Type-Options header',
      ur: 'X-Content-Type-Options header lagayein',
    },
    why: {
      en: 'Without "nosniff" a browser may guess the type of a file and treat it as something else.',
      ur: '"nosniff" ke baghair browser file ki qism ka andaza laga kar use kuch aur samajh sakta hai.',
    },
    steps: [
      {
        en: 'Send the header "X-Content-Type-Options: nosniff" from your host or server.',
        ur: 'Apne host ya server se header "X-Content-Type-Options: nosniff" bhejein.',
      },
    ],
  },
  framing: {
    severity: 'low',
    title: {
      en: 'Say who may show the page in a frame',
      ur: 'Batayein ke page ko frame mein kaun dikha sakta hai',
    },
    why: {
      en: 'The page does not say who may show it inside a frame, so another site could frame it.',
      ur: 'Page nahi batata ke use frame mein kaun dikha sakta hai, isliye koi doosri site use frame kar sakti hai.',
    },
    steps: [
      {
        en: 'Send "X-Frame-Options: DENY", or "frame-ancestors \'self\'" inside the Content-Security-Policy header.',
        ur: '"X-Frame-Options: DENY" bhejein, ya Content-Security-Policy header ke andar "frame-ancestors \'self\'" likhein.',
      },
    ],
  },
  'referrer-policy': {
    severity: 'info',
    title: {
      en: 'Add a Referrer-Policy header',
      ur: 'Referrer-Policy header lagayein',
    },
    why: {
      en: 'Without it a browser may pass the full address of your pages to other sites.',
      ur: 'Iske baghair browser aapke pages ka poora address doosri sites ko de sakta hai.',
    },
    steps: [
      {
        en: 'Send the header "Referrer-Policy: strict-origin-when-cross-origin" from your host or server.',
        ur: 'Apne host ya server se header "Referrer-Policy: strict-origin-when-cross-origin" bhejein.',
      },
    ],
  },
};

function required(plan: readonly PlannedCheck[], id: string): boolean {
  return plan.find((c) => c.id === id)?.required ?? false;
}

function titleOf(plan: readonly PlannedCheck[], id: string): Text {
  return (
    plan.find((c) => c.id === id)?.title ??
    CHECKS.find((c) => c.id === id)?.title ?? { en: id, ur: id }
  );
}

/** Names of parts that were not read: sorted, at most MAX_NAMES, then "and N more". */
function namesText(names: readonly string[]): Text {
  const sorted = [...names].sort(compareText);
  const shown = sorted.slice(0, MAX_NAMES).join(', ');
  const more = sorted.length - MAX_NAMES;
  return {
    en: more > 0 ? `${shown} and ${more} more` : shown,
    ur: more > 0 ? `${shown} aur ${more} mazeed` : shown,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Short ids first (fnd_9 before fnd_10), then plain text order. */
function compareRef(a: string, b: string): number {
  return a.length - b.length || compareText(a, b);
}

const refKey = (item: Draft) =>
  item.refs.findingIds?.[0] ?? item.refs.evidenceIds?.[0] ?? item.refs.checkId;

function compareDrafts(a: Draft, b: Draft): number {
  return (
    SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity) ||
    (a.fromRequiredCheck === b.fromRequiredCheck
      ? 0
      : a.fromRequiredCheck
        ? -1
        : 1) ||
    KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind) ||
    compareRef(refKey(a), refKey(b)) ||
    compareText(a.refs.checkId, b.refs.checkId)
  );
}

export function buildRoadmap(input: RoadmapInput): Roadmap {
  const { plan, findings, evidence, coverage, cleanup } = input;
  const supabase = input.provided ? input.provided.supabase : true;
  const drafts: Draft[] = [];

  // A leaked table: fix it. The SQL stays with the finding.
  for (const item of evidence) {
    if (!isTable(item) || item.verdict !== 'LEAKED' || !item.findingId) continue;
    const found = findings.find((f) => f.id === item.findingId);
    const table = item.table ?? found?.table ?? '';
    drafts.push({
      kind: 'fix-finding',
      severity: found?.severity ?? 'critical',
      fromRequiredCheck: required(plan, DATA_ACCESS),
      title: {
        en: `Fix the leak in table "${table}"`,
        ur: `Table "${table}" ka leak theek karein`,
      },
      why: {
        en: 'Rows of this table that belong to one user could be reached by someone else in the test.',
        ur: 'Is table ki jo rows ek user ki hain, test mein unhein koi aur dekh ya badal sakta tha.',
      },
      steps: [
        {
          en: `Open finding ${item.findingId} in the report and read the suggested fix.`,
          ur: `Report mein finding ${item.findingId} kholein aur suggest kiya gaya fix parhein.`,
        },
        {
          en: 'Read the SQL, then run it in the Supabase SQL editor of your TEST project.',
          ur: 'SQL parhein, phir use apne TEST project ke Supabase SQL editor mein chalayein.',
        },
        {
          en: 'Press "Approve fix" to record your decision.',
          ur: 'Apna faisla likhne ke liye "Approve fix" dabayein.',
        },
        {
          en: 'Press "Re-test" and check that the table is no longer a leak.',
          ur: '"Re-test" dabayein aur dekhein ke table ab leak nahi raha.',
        },
      ],
      // A finding that has a fix SQL had an owner column; one without does not.
      fixPrompt: fixFindingPrompt(table, found?.fix != null),
      refs: {
        checkId: DATA_ACCESS,
        findingIds: [item.findingId],
        evidenceIds: [item.id],
      },
    });
  }

  // A table the checks could not judge: ask a person to confirm.
  for (const item of evidence) {
    if (!isTable(item) || item.verdict !== 'INCONCLUSIVE' || !item.findingId) {
      continue;
    }
    const found = findings.find((f) => f.id === item.findingId);
    const table = item.table ?? found?.table ?? '';
    drafts.push({
      kind: 'confirm',
      severity: found?.severity ?? 'low',
      fromRequiredCheck: required(plan, DATA_ACCESS),
      title: {
        en: `Confirm that table "${table}" is meant to be like this`,
        ur: `Tasdeeq karein ke table "${table}" aisa hi hona chahiye`,
      },
      why: {
        en: 'The checks could not tell whether this table is a problem. It may be public on purpose, or it could not be tested.',
        ur: 'Checks nahi bata sake ke ye table masla hai ya nahi. Ho sakta hai ye jaan boojh kar public ho, ya iska test na ho saka ho.',
      },
      steps: [
        {
          en: 'Decide whether everyone may read this table (for example a public hotel list).',
          ur: 'Faisla karein ke is table ko har koi parh sakta hai ya nahi (jaise public hotel list).',
        },
        {
          en: 'If it holds private data, add a row-level security rule, then run a re-test.',
          ur: 'Agar isme private data hai to row-level security ka rule lagayein, phir re-test chalayein.',
        },
      ],
      refs: {
        checkId: DATA_ACCESS,
        findingIds: [item.findingId],
        evidenceIds: [item.id],
      },
    });
  }

  // A secret key in a script of the site: the most urgent thing there is.
  for (const item of evidence) {
    if (item.kind !== 'site-bundle' || item.verdict !== 'LEAKED') continue;
    const subject = plain(item.subject, 'a script');
    drafts.push({
      kind: 'fix-site-secret',
      severity: 'critical',
      fromRequiredCheck: required(plan, BUNDLE),
      title: {
        en: `Remove the secret key from the script "${subject}"`,
        ur: `Script "${subject}" se secret key hatayein`,
      },
      why: {
        en: 'A Supabase secret key was found in a script that any visitor can download. Anyone who reads it can use the key.',
        ur: 'Ek Supabase secret key aisi script mein mili jise har visitor download kar sakta hai. Jo bhi use parhe wo key istemal kar sakta hai.',
      },
      steps: [
        {
          en: 'Rotate the key now: in Supabase go to API keys, create a new secret key and delete the old one.',
          ur: 'Key abhi rotate karein: Supabase -> API keys mein nayi secret key banayein aur purani delete karein.',
        },
        {
          en: 'Remove the key from your code and from any env file that is built into the site. Use it only on a server.',
          ur: 'Key ko apne code se aur us env file se hatayein jo site mein build hoti hai. Ise sirf server par istemal karein.',
        },
        {
          en: 'Redeploy the site, so the old script is replaced.',
          ur: 'Site redeploy karein, taake purani script badal jaye.',
        },
        {
          en: 'Run the audit again to check that the key is gone.',
          ur: 'Audit dobara chalayein aur dekhein ke key ab nahi hai.',
        },
      ],
      fixPrompt: fixSiteSecretPrompt(item.subject),
      refs: { checkId: BUNDLE, evidenceIds: [item.id] },
    });
  }

  // A secret key in a file of the GitHub repository. The key is in the history
  // of the repository too, so removing the file is not enough: rotate it.
  for (const item of evidence) {
    if (item.kind !== 'repo-file' || item.verdict !== 'LEAKED') continue;
    const subject = plain(item.subject, 'a file');
    drafts.push({
      kind: 'fix-repo-secret',
      severity: 'critical',
      fromRequiredCheck: required(plan, REPO),
      title: {
        en: `Remove the secret key from the file "${subject}" and rotate it`,
        ur: `File "${subject}" se secret key hatayein aur use rotate karein`,
      },
      why: {
        en: 'A Supabase secret key was found in a file of the public repository. Anyone can read it there, and the old commits keep it even after the file is changed.',
        ur: 'Ek Supabase secret key public repository ki file mein mili. Wahan jo bhi chahe parh sakta hai, aur file badalne ke baad bhi purane commits mein rehti hai.',
      },
      steps: [
        {
          en: 'Rotate the key now: in Supabase go to API keys, create a new secret key and delete the old one.',
          ur: 'Key abhi rotate karein: Supabase -> API keys mein nayi secret key banayein aur purani delete karein.',
        },
        {
          en: 'Take the key out of the file, keep it only in an env file that is not committed, and add that file to .gitignore.',
          ur: 'Key ko file se nikalein, use sirf aisi env file mein rakhein jo commit nahi hoti, aur us file ko .gitignore mein daalein.',
        },
        {
          en: 'Run the audit again to check that the key is gone from the files.',
          ur: 'Audit dobara chalayein aur dekhein ke key ab files mein nahi hai.',
        },
      ],
      fixPrompt: fixRepoSecretPrompt(item.subject),
      refs: { checkId: REPO, evidenceIds: [item.id] },
    });
  }

  // A public variable name that says SECRET or SERVICE_ROLE (rule 2). Only a
  // warning: the value was not looked at, so it is high, never critical, and
  // it never changes the gate by itself.
  for (const item of evidence) {
    if (item.kind !== 'repo-env-name' || item.verdict !== 'INCONCLUSIVE') {
      continue;
    }
    const subject = plain(item.subject, 'a file');
    drafts.push({
      kind: 'improve-repo',
      severity: 'high',
      fromRequiredCheck: required(plan, REPO),
      title: {
        en: `Check the secret-looking variable in the file "${subject}"`,
        ur: `File "${subject}" ki secret jaisi variable dekhein`,
      },
      why: {
        en: 'A variable that starts with NEXT_PUBLIC_ or VITE_ is sent to every visitor by the browser build, and its name says it is a secret. The value was not checked.',
        ur: 'NEXT_PUBLIC_ ya VITE_ se shuru hone wali variable browser build har visitor ko bhej deta hai, aur uska naam kehta hai ke ye secret hai. Value check nahi hui.',
      },
      steps: [
        {
          en: 'Open the file and find out what the variable holds.',
          ur: 'File kholein aur dekhein ke variable mein kya hai.',
        },
        {
          en: 'If it holds a secret, rotate it in Supabase, rename it without NEXT_PUBLIC_ or VITE_, and use it only in server code.',
          ur: 'Agar isme secret hai to Supabase mein rotate karein, NEXT_PUBLIC_ ya VITE_ ke baghair naam rakhein, aur sirf server code mein use karein.',
        },
        {
          en: 'If it is not a secret, rename it so the name does not say so.',
          ur: 'Agar secret nahi hai to naam aisa rakhein jo secret na kahe.',
        },
        {
          en: 'Run the audit again to check the file.',
          ur: 'File dekhne ke liye audit dobara chalayein.',
        },
      ],
      fixPrompt: improveRepoPrompt('public-env-secret', item.subject),
      refs: { checkId: REPO, evidenceIds: [item.id] },
    });
  }

  // A table a migration creates with no "enable row level security" in any
  // migration (rule 1). The real database may differ, so it is a warning only:
  // medium, and it never changes the gate by itself.
  for (const item of evidence) {
    if (item.kind !== 'repo-migration' || item.verdict !== 'INCONCLUSIVE') {
      continue;
    }
    const table = plain(item.table ?? undefined, 'a table');
    drafts.push({
      kind: 'improve-repo',
      severity: 'medium',
      fromRequiredCheck: required(plan, REPO),
      title: {
        en: `Check row level security for the table "${table}" in the migrations`,
        ur: `Migrations mein table "${table}" ki row level security dekhein`,
      },
      why: {
        en: 'A migration creates this table, and no migration turns on row level security for it. It may be enabled elsewhere, for example in the Supabase dashboard, so this could not be confirmed from the repository.',
        ur: 'Ek migration ye table banati hai, aur koi migration iske liye row level security on nahi karti. Ho sakta hai ye kahin aur on ho, maslan Supabase dashboard mein, isliye repository se tasdeeq nahi ho saki.',
      },
      steps: [
        {
          en: 'In Supabase open the table and check whether row level security is on.',
          ur: 'Supabase mein table kholein aur dekhein ke row level security on hai ya nahi.',
        },
        {
          en: 'If it is off, add a migration with "enable row level security" for this table and the policies it needs.',
          ur: 'Agar off hai to is table ke liye "enable row level security" aur zaroori policies wali migration lagayein.',
        },
        {
          en: 'If it is on elsewhere, add the same line to a migration so the repository tells the truth.',
          ur: 'Agar kahin aur on hai to wahi line kisi migration mein bhi likhein taake repository sach bataye.',
        },
        {
          en: 'Run the audit again to check the migrations.',
          ur: 'Migrations dekhne ke liye audit dobara chalayein.',
        },
      ],
      fixPrompt: improveRepoPrompt('migration-rls', item.table ?? undefined),
      refs: { checkId: REPO, evidenceIds: [item.id] },
    });
  }

  // A header that is missing or weak. A header that is there gets nothing.
  for (const item of evidence) {
    if (item.kind !== 'site-headers' || item.verdict !== 'INCONCLUSIVE') {
      continue;
    }
    const advice = HEADER_ADVICE[item.subject ?? ''];
    if (!advice) continue;
    drafts.push({
      kind: 'improve-header',
      severity: advice.severity,
      fromRequiredCheck: required(plan, HEADERS),
      title: advice.title,
      why: advice.why,
      steps: advice.steps,
      ...fixPromptField(improveHeaderPrompt(item.subject)),
      refs: { checkId: HEADERS, evidenceIds: [item.id] },
    });
  }

  // The Prover's temporary users could not be removed.
  if (cleanup === 'failed') {
    drafts.push({
      kind: 'cleanup',
      severity: 'high',
      fromRequiredCheck: required(plan, DATA_ACCESS),
      title: {
        en: 'Remove the temporary test users and rows by hand',
        ur: 'Aarzi test users aur rows haath se hatayein',
      },
      why: {
        en: 'The audit could not remove everything it made in your test project.',
        ur: 'Audit apni banayi hui har cheez aapke test project se hata nahi saka.',
      },
      steps: [
        {
          en: 'In Supabase open Authentication and delete the users with an email like vca-...@example.com.',
          ur: 'Supabase mein Authentication kholein aur vca-...@example.com jaisi email wale users delete karein.',
        },
        {
          en: 'Look for leftover canary rows in your tables and delete them.',
          ur: 'Apne tables mein bachi hui canary rows dhoondein aur delete karein.',
        },
      ],
      refs: { checkId: DATA_ACCESS },
    });
  }

  // A check that ran only in part, or broke.
  const unfinished = [
    ...coverage.partial.map((c) => ({
      id: c.id,
      notRead: c.notRead.map((n) => n.name),
      partial: true,
    })),
    ...coverage.failedToRun.map((c) => ({
      id: c.id,
      notRead: [] as string[],
      partial: false,
    })),
  ];
  for (const check of unfinished) {
    const title = titleOf(plan, check.id);
    const names = namesText(check.notRead);
    drafts.push({
      kind: 'finish-check',
      severity: 'medium',
      fromRequiredCheck: required(plan, check.id),
      title: {
        en: `Finish the check "${title.en}"`,
        ur: `Check "${title.ur}" poora karein`,
      },
      why: check.partial
        ? {
            en:
              check.notRead.length > 0
                ? `This check ran, but it could not read everything. Not read: ${names.en}.`
                : 'This check ran, but it could not read everything.',
            ur:
              check.notRead.length > 0
                ? `Ye check chala, lekin sab kuch parh nahi saka. Parha nahi gaya: ${names.ur}.`
                : 'Ye check chala, lekin sab kuch parh nahi saka.',
          }
        : {
            en: 'This check could not run to the end, so it says nothing about what it should look at.',
            ur: 'Ye check poora chal nahi saka, isliye jis cheez ko dekhna tha uske bare mein kuch nahi batata.',
          },
      steps: check.partial
        ? [
            {
              en: 'Find out why those parts were not read (a size or time limit).',
              ur: 'Pata karein ke wo hisse kyun nahi parhe gaye (size ya waqt ki had).',
            },
            {
              en: 'Run the audit again.',
              ur: 'Audit dobara chalayein.',
            },
          ]
        : [
            {
              en: 'Check that the address and the details you gave are right and that the site or project can be reached.',
              ur: 'Dekhein ke jo address aur details aapne di hain wo theek hain aur site ya project tak pahuncha ja sakta hai.',
            },
            {
              en: 'Run the audit again.',
              ur: 'Audit dobara chalayein.',
            },
          ],
      refs: { checkId: check.id },
    });
  }

  // An optional check whose input was not given.
  for (const skipped of coverage.skipped) {
    if (!skipped.reason.en.startsWith('Not provided')) continue;
    const needs = CHECKS.find((c) => c.id === skipped.id)?.needs;
    if (!needs) continue;
    const title = titleOf(plan, skipped.id);
    drafts.push({
      kind: 'provide-input',
      severity: 'info',
      fromRequiredCheck: required(plan, skipped.id),
      title:
        needs === 'website'
          ? {
              en: 'Add a website address to check the site too',
              ur: 'Site bhi check karne ke liye website ka address dein',
            }
          : {
              en: 'Add Supabase details to check your tables too',
              ur: 'Tables bhi check karne ke liye Supabase ki details dein',
            },
      why: {
        en: `"${title.en}" was not checked, because it was not provided.`,
        ur: `"${title.ur}" check nahi hua, kyunke diya nahi gaya.`,
      },
      steps:
        needs === 'website'
          ? [
              {
                en: 'Type the public https address of your website, and confirm that you may test it.',
                ur: 'Apni website ka public https address likhein, aur tasdeeq karein ke aap use test kar sakte hain.',
              },
              { en: 'Run the audit again.', ur: 'Audit dobara chalayein.' },
            ]
          : [
              {
                en: 'Type the project URL, the anon key and the service key of a TEST project, and confirm that it is a test project.',
                ur: 'Ek TEST project ka project URL, anon key aur service key likhein, aur tasdeeq karein ke ye test project hai.',
              },
              { en: 'Run the audit again.', ur: 'Audit dobara chalayein.' },
            ],
      refs: { checkId: skipped.id },
    });
  }

  // After a fix: run the checks again (only possible with Supabase details).
  const hasFix = drafts.some(
    (d) =>
      d.kind === 'fix-finding' ||
      d.kind === 'fix-site-secret' ||
      d.kind === 'improve-header' ||
      d.kind === 'cleanup',
  );
  if (hasFix && supabase) {
    drafts.push({
      kind: 'retest',
      severity: 'info',
      fromRequiredCheck: required(plan, DATA_ACCESS),
      title: {
        en: 'Re-test after you fix things',
        ur: 'Theek karne ke baad re-test karein',
      },
      why: {
        en: 'A re-test runs the same checks again and shows whether each fix worked.',
        ur: 'Re-test wohi checks dobara chalata hai aur dikhata hai ke har fix kaam kar gaya ya nahi.',
      },
      steps: [
        {
          en: 'Press "Re-test" and enter the keys of your TEST project again (they are never stored).',
          ur: '"Re-test" dabayein aur apne TEST project ki keys dobara dein (wo kabhi save nahi hotin).',
        },
      ],
      refs: { checkId: DATA_ACCESS },
    });
  }

  drafts.sort(compareDrafts);
  const kept = drafts.slice(0, ROADMAP_CAP);
  return {
    schemaVersion: 1,
    items: kept.map((draft, index) => ({
      id: `rm_${String(index + 1).padStart(3, '0')}`,
      ...draft,
    })),
    truncated: drafts.length - kept.length,
  };
}
