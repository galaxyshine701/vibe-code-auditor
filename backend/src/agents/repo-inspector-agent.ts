import { REPO_CHECK, REPO_CHECK_ID, notProvidedReason } from '../stages/planner-config.js';
import type { KeyKind } from '../stages/site-rules.js';
import type { EvidenceItem, Text } from '../stages/types.js';
import { createGithubTransport } from '../repo/github-transport.js';
import { REPO_SCAN_LIMITS } from '../repo/repo-limits.js';
import {
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
    en: 'The repository archive was refused by the safety limits (too many files, too much data, or an unsafe path), so it was not read.',
    ur: 'Repository ka archive safety limits ne radd kar diya (bahut zyada files, bahut zyada data, ya ghair mehfooz path), isliye wo parhi nahi gayi.',
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
        kind: 'repo-file' as const,
        verdict: 'LEAKED' as const,
        proof: 'PROVEN' as const,
        summary: WHAT_FOUND[hit.kind],
      }));
      (context.siteEvidence ??= []).push(...items);

      // A binary file is not a miss. A big file or a link is.
      const missed = outcome.notRead.filter((n) => NOT_READ[n.reason]);
      results[REPO_INSPECTOR_ID] =
        missed.length > 0
          ? {
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
          : { id: REPO_INSPECTOR_ID, status: 'completed' };
      setProgress(100);
    },
  };
}
