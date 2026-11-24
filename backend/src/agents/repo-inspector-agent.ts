import { REPO_CHECK, REPO_CHECK_ID, notProvidedReason } from '../stages/planner-config.js';
import { KEY_PROVIDERS, foundInRepo } from '../stages/key-providers.js';
import type { KeyKind } from '../stages/site-rules.js';
import type { EvidenceItem, Text } from '../stages/types.js';
import { MAX_ENV_FILE_HITS } from '../repo/env-file-rules.js';
import { MAX_MIGRATION_HITS } from '../repo/migration-rules.js';
import { createGithubTransport } from '../repo/github-transport.js';
import { REPO_SCAN_LIMITS } from '../repo/repo-limits.js';
import {
  MAX_NAME_HITS,
  MAX_TEST_KEY_HITS,
  scanRepo,
  type RepoNotReadReason,
  type RepoTransport,
} from '../repo/repo-scanner.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';
import { RUN_STOPPED } from './site-agent-kit.js';

export const REPO_INSPECTOR_ID = REPO_CHECK_ID;

/** A key-like value in a test path: not proven, so a warning only. */
function whatTestKey(kind: KeyKind): Text {
  const label = KEY_PROVIDERS[kind].label;
  return {
    en: `This file is in a test path and holds ${label.en}. Test files often hold fake values, so this is not proven to be a real leak. If the key is real, anyone who opens the repository can read it and old commits keep it: rotate it and remove it from the file.`,
    ur: `Ye file test ke path mein hai aur isme ${label.ur} jaisi value hai. Test files mein aksar nakli values hoti hain, isliye ye sabit shuda leak nahi. Agar key asli hai to jo bhi repository kholta hai use parh sakta hai aur purane commits mein rehti hai: use rotate karein aur file se hatayein.`,
  };
}

/** Said in the limits when more keys than the list holds were found in test paths. */
const TEST_LIST_CUT: Text = {
  en: `The list of keys found in test paths is not complete: only the first ${MAX_TEST_KEY_HITS} are listed.`,
  ur: `Test paths mein milne wali keys ki list mukammal nahi: sirf pehli ${MAX_TEST_KEY_HITS} likhi gayi hain.`,
};

/** A committed env file with secret-looking variables. Names only, never a value. */
function whatEnvFile(names: string[], more: number): Text {
  const list = names.join(', ') + (more > 0 ? ` and ${more} more` : '');
  const listUr = names.join(', ') + (more > 0 ? ` aur ${more} aur` : '');
  return {
    en: `This env file is committed to the repository and has variables with secret-looking names and a value: ${list}. Anyone who opens the repository can read the file, and old commits keep it. The values were not checked, so this is a warning sign, not a proven leak.`,
    ur: `Ye env file repository mein commit hai aur isme secret jaise naam wali variables hain jin ki value likhi hai: ${listUr}. Jo bhi repository kholta hai file parh sakta hai, aur purane commits mein rehti hai. Values check nahi hui, isliye ye khatre ki nishani hai, sabit shuda leak nahi.`,
  };
}

/** Said in the limits when more env files than the list holds. */
const ENV_LIST_CUT: Text = {
  en: `The list of committed env files with secret-looking variables is not complete: only the first ${MAX_ENV_FILE_HITS} files are listed.`,
  ur: `Secret jaisi variables wali committed env files ki list mukammal nahi: sirf pehli ${MAX_ENV_FILE_HITS} files likhi gayi hain.`,
};

const WHAT_NAME: Text = {
  en: 'A variable in this file starts with NEXT_PUBLIC_ or VITE_ and has SECRET or SERVICE_ROLE in its name. A browser build publishes such variables to every visitor. The value was not checked: this is a warning sign, not a proven leak.',
  ur: 'Is file ki ek variable NEXT_PUBLIC_ ya VITE_ se shuru hoti hai aur uske naam mein SECRET ya SERVICE_ROLE hai. Browser build aisi variables har visitor ko publish kar deta hai. Value check nahi hui: ye khatre ki nishani hai, sabit shuda leak nahi.',
};

const WHAT_MIGRATION: Text = {
  en: 'A migration creates this table, and no migration in the repository turns on row level security for it. It may be enabled elsewhere (for example in the Supabase dashboard), so this is a warning sign, not a proven leak.',
  ur: 'Ek migration ye table banati hai, aur repository ki koi migration iske liye row level security on nahi karti. Ho sakta hai ye kahin aur (maslan Supabase dashboard mein) on ho, isliye ye khatre ki nishani hai, sabit shuda leak nahi.',
};

/** Said in the limits when more tables than the list holds. */
const MIGRATION_LIST_CUT: Text = {
  en: `The list of tables without row level security in the migrations is not complete: only the first ${MAX_MIGRATION_HITS} tables are listed.`,
  ur: `Migrations mein row level security ke baghair tables ki list mukammal nahi: sirf pehle ${MAX_MIGRATION_HITS} tables likhe gaye hain.`,
};

/** Said in the limits when more files had such a name than the list holds. */
const NAME_LIST_CUT: Text = {
  en: `The list of variable names that say SECRET or SERVICE_ROLE is not complete: only the first ${MAX_NAME_HITS} files are listed.`,
  ur: `SECRET ya SERVICE_ROLE kehne wali variable ke naamon ki list mukammal nahi: sirf pehli ${MAX_NAME_HITS} files likhi gayi hain.`,
};

/** One fixed sentence for each reason the repository could not be read. */
const FAILURE: Record<RepoNotReadReason, Text> = {
  'not-found': {
    en: 'The repository was not found, or it is private. Only public repositories can be read.',
    ur: 'Repository nahi mili, ya wo private hai. Sirf public repositories parhi ja sakti hain.',
  },
  'rate-limited': {
    en: 'GitHub refused the request (a rate limit or no access), so the repository was not read. Try again later.',
    ur: 'GitHub ne request radd kar di (rate limit ya access nahi), isliye repository parhi nahi gayi. Baad mein dobara try karein.',
  },
  'too-large': {
    en: 'The repository is larger than the allowed size, so it was not read.',
    ur: 'Repository ki size had se zyada hai, isliye wo parhi nahi gayi.',
  },
  'archive-refused': {
    en: 'The repository archive was refused by the limits of the scan (too many files, too much data, or a path that is not allowed), so it was not read.',
    ur: 'Repository ka archive scan ki hudood ne radd kar diya (bahut zyada files, bahut zyada data, ya aisa path jo allowed nahi), isliye wo parhi nahi gayi.',
  },
  'could-not-fetch': {
    en: 'The repository could not be fetched from GitHub in time, so it was not read.',
    ur: 'Repository GitHub se waqt par laayi nahi ja saki, isliye wo parhi nahi gayi.',
  },
  symlink: {
    en: 'A link file was not followed.',
    ur: 'Link wali file follow nahi hui.',
  },
  binary: { en: 'A binary file was not read.', ur: 'Binary file parhi nahi gayi.' },
};

const NOT_READ: Partial<Record<RepoNotReadReason, Text>> = {
  'too-large': {
    en: 'Not read: the file is larger than the allowed size.',
    ur: 'Parhi nahi gayi: file ki size had se zyada hai.',
  },
  symlink: {
    en: 'Not read: it is a link, and links are never followed.',
    ur: 'Parhi nahi gayi: ye link hai, aur links follow nahi hote.',
  },
};

/** At most this many names of unread files are listed. */
const MAX_NOT_READ_LISTED = 50;

/**
 * Inspector for the check "repo-secrets": reads the zip of the public GitHub
 * repository (through the transport only, within the caps) and looks for
 * Supabase secret keys in its text files. It never tests whether a key works,
 * never copies a key (only the kind and the file's path), looks at the stop
 * flag before it starts, and says what it could not read. Plain code.
 */
export function createRepoInspectorAgent(
  options: { transport?: RepoTransport } = {},
): Agent<RunContext> {
  const transport = options.transport ?? createGithubTransport();
  return {
    id: REPO_INSPECTOR_ID,
    name: 'Repo scan',
    critical: false,
    async run(context, setProgress, control) {
      const repo = context.repoRef;
      const results = context.siteResults;
      if (!repo || !results) {
        return { skipped: notProvidedReason(REPO_CHECK) };
      }
      const fail = (reason: Text) => {
        results[REPO_INSPECTOR_ID] = {
          id: REPO_INSPECTOR_ID,
          status: 'failedToRun',
          reason,
        };
      };
      if (control?.shouldStop()) return fail(RUN_STOPPED);

      setProgress(5);
      const abort = new AbortController();
      // the run's stop flag is polled, so the download stops when the run does
      const poll = setInterval(() => {
        if (control?.shouldStop()) abort.abort();
      }, 500);
      poll.unref();
      let outcome;
      try {
        outcome = await scanRepo(transport, repo, {
          limits: REPO_SCAN_LIMITS,
          signal: abort.signal,
        });
      } finally {
        clearInterval(poll);
      }
      if (!outcome.completed) {
        return fail(
          control?.shouldStop()
            ? RUN_STOPPED
            : FAILURE[outcome.failure ?? 'could-not-fetch'],
        );
      }

      // A key in a normal file is a proven leak. The same key in a test path
      // may be a fake one: INCONCLUSIVE, never LEAKED, never a gate reason.
      const leaks = outcome.hits.filter((hit) => !hit.testPath);
      const testKeys = outcome.hits.filter((hit) => hit.testPath);
      const items: EvidenceItem[] = leaks.map((hit, index) => ({
        id: `ev_site_${REPO_INSPECTOR_ID}_${index + 1}`,
        check: REPO_INSPECTOR_ID,
        findingId: null,
        table: null,
        subject: hit.path,
        line: hit.line,
        kind: 'repo-file' as const,
        keyKind: hit.kind,
        verdict: 'LEAKED' as const,
        proof: 'PROVEN' as const,
        summary: foundInRepo(hit.kind),
      }));
      const testItems: EvidenceItem[] = testKeys.map((hit, index) => ({
        id: `ev_site_${REPO_INSPECTOR_ID}_${items.length + index + 1}`,
        check: REPO_INSPECTOR_ID,
        findingId: null,
        table: null,
        subject: hit.path,
        line: hit.line,
        kind: 'repo-test-key' as const,
        keyKind: hit.kind,
        verdict: 'INCONCLUSIVE' as const,
        proof: 'UNVERIFIED' as const,
        summary: whatTestKey(hit.kind),
      }));
      // Rule 3: a committed env file with a secret-looking variable and a value.
      // Names and path only. The value is not tested: INCONCLUSIVE, never LEAKED.
      const envItems: EvidenceItem[] = outcome.envHits.map((hit, index) => ({
        id: `ev_site_${REPO_INSPECTOR_ID}_${items.length + testItems.length + index + 1}`,
        check: REPO_INSPECTOR_ID,
        findingId: null,
        table: null,
        subject: hit.path,
        line: hit.line,
        kind: 'repo-env-file' as const,
        verdict: 'INCONCLUSIVE' as const,
        proof: 'UNVERIFIED' as const,
        summary: whatEnvFile(hit.names, hit.more),
      }));
      // Rule 2: a public variable name that says SECRET or SERVICE_ROLE. The
      // check can not see the value's use, so it is INCONCLUSIVE, never LEAKED.
      const nameItems: EvidenceItem[] = outcome.nameHits.map((hit, index) => ({
        id: `ev_site_${REPO_INSPECTOR_ID}_${items.length + testItems.length + envItems.length + index + 1}`,
        check: REPO_INSPECTOR_ID,
        findingId: null,
        table: null,
        subject: hit.path,
        line: hit.line,
        kind: 'repo-env-name' as const,
        verdict: 'INCONCLUSIVE' as const,
        proof: 'UNVERIFIED' as const,
        summary: WHAT_NAME,
      }));
      // Rule 1: a table a migration creates, with no "enable row level security"
      // in any migration. The real database may differ: INCONCLUSIVE only.
      const migrationItems: EvidenceItem[] = outcome.migrationHits.map(
        (hit, index) => ({
          id: `ev_site_${REPO_INSPECTOR_ID}_${items.length + testItems.length + envItems.length + nameItems.length + index + 1}`,
          check: REPO_INSPECTOR_ID,
          findingId: null,
          table: hit.table,
          subject: hit.path,
          line: hit.line,
          kind: 'repo-migration' as const,
          verdict: 'INCONCLUSIVE' as const,
          proof: 'UNVERIFIED' as const,
          summary: WHAT_MIGRATION,
        }),
      );
      (context.siteEvidence ??= []).push(
        ...items,
        ...testItems,
        ...envItems,
        ...nameItems,
        ...migrationItems,
      );

      // A binary file is not a miss. A big file or a link is.
      const missed = outcome.notRead.filter((n) => NOT_READ[n.reason]);
      const notes = [
        ...(outcome.testHitsCut ? [TEST_LIST_CUT] : []),
        ...(outcome.envHitsCut ? [ENV_LIST_CUT] : []),
        ...(outcome.nameHitsCut ? [NAME_LIST_CUT] : []),
        ...(outcome.migrationHitsCut ? [MIGRATION_LIST_CUT] : []),
      ];
      const cut = notes.length > 0 ? { limitNotes: notes } : {};
      results[REPO_INSPECTOR_ID] =
        missed.length > 0
          ? {
              ...cut,
              filesRead: outcome.filesScanned,
              id: REPO_INSPECTOR_ID,
              status: 'partial',
              reason: {
                en: 'Some files of the repository were not read, so this check is not complete.',
                ur: 'Repository ki kuch files parhi nahi gayin, isliye ye check mukammal nahi.',
              },
              notRead: missed.slice(0, MAX_NOT_READ_LISTED).map((n) => ({
                name: n.path.slice(0, 120),
                reason: NOT_READ[n.reason]!,
              })),
            }
          : {
              id: REPO_INSPECTOR_ID,
              status: 'completed',
              filesRead: outcome.filesScanned,
              ...cut,
            };
      setProgress(100);
    },
  };
}
