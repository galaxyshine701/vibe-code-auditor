import { REPO_CHECK, REPO_CHECK_ID, notProvidedReason } from '../stages/planner-config.js';
import type { KeyKind } from '../stages/site-rules.js';
import type { EvidenceItem, Text } from '../stages/types.js';
import { createGithubTransport } from '../repo/github-transport.js';
import { REPO_SCAN_LIMITS } from '../repo/repo-limits.js';
import {
  MAX_NAME_HITS,
  scanRepo,
  type RepoNotReadReason,
  type RepoTransport,
} from '../repo/repo-scanner.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';
import { RUN_STOPPED } from './site-agent-kit.js';

export const REPO_INSPECTOR_ID = REPO_CHECK_ID;

const WHAT_FOUND: Record<KeyKind, Text> = {
  'secret-key': {
    en: 'A Supabase secret key (sb_secret_...) is in this file of the repository. Anyone who opens the repository can read it, and old commits keep it. Rotate the key and remove it from the file.',
    ur: 'Repository ki is file mein Supabase ki secret key (sb_secret_...) maujood hai. Jo bhi repository kholta hai use parh sakta hai, aur purane commits mein bhi rehti hai. Key rotate karein aur file se hatayein.',
  },
  'service-role-jwt': {
    en: 'A Supabase service_role key is in this file of the repository. Anyone who opens the repository can read it, and old commits keep it. Rotate the key and remove it from the file.',
    ur: 'Repository ki is file mein Supabase ki service_role key maujood hai. Jo bhi repository kholta hai use parh sakta hai, aur purane commits mein bhi rehti hai. Key rotate karein aur file se hatayein.',
  },
};

const WHAT_NAME: Text = {
  en: 'A variable in this file starts with NEXT_PUBLIC_ or VITE_ and has SECRET or SERVICE_ROLE in its name. A browser build publishes such variables to every visitor. The value was not checked: this is a warning sign, not a proven leak.',
  ur: 'Is file ki ek variable NEXT_PUBLIC_ ya VITE_ se shuru hoti hai aur uske naam mein SECRET ya SERVICE_ROLE hai. Browser build aisi variables har visitor ko publish kar deta hai. Value check nahi hui: ye khatre ki nishani hai, sabit shuda leak nahi.',
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

      const items: EvidenceItem[] = outcome.hits.map((hit, index) => ({
        id: `ev_site_${REPO_INSPECTOR_ID}_${index + 1}`,
        check: REPO_INSPECTOR_ID,
        findingId: null,
        table: null,
        subject: hit.path,
        line: hit.line,
        kind: 'repo-file' as const,
        verdict: 'LEAKED' as const,
        proof: 'PROVEN' as const,
        summary: WHAT_FOUND[hit.kind],
      }));
      // Rule 2: a public variable name that says SECRET or SERVICE_ROLE. The
      // check can not see the value's use, so it is INCONCLUSIVE, never LEAKED.
      const nameItems: EvidenceItem[] = outcome.nameHits.map((hit, index) => ({
        id: `ev_site_${REPO_INSPECTOR_ID}_${items.length + index + 1}`,
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
      (context.siteEvidence ??= []).push(...items, ...nameItems);

      // A binary file is not a miss. A big file or a link is.
      const missed = outcome.notRead.filter((n) => NOT_READ[n.reason]);
      const cut = outcome.nameHitsCut
        ? { limitNotes: [NAME_LIST_CUT] }
        : {};
      results[REPO_INSPECTOR_ID] =
        missed.length > 0
          ? {
              ...cut,
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
          : { id: REPO_INSPECTOR_ID, status: 'completed', ...cut };
      setProgress(100);
    },
  };
}
