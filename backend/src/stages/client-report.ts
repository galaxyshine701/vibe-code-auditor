import { GATE_UNAVAILABLE } from './failsafe.js';
import type {
  ClientReport,
  Coverage,
  EvidenceItem,
  Gate,
  PlannedCheck,
  Roadmap,
  ScopeEntry,
  Text,
} from './types.js';

/**
 * The client report: a short summary of one run for a person who does not
 * read the details. Plain code. Every number comes from the evidence, the
 * coverage and the gate that were already worked out; nothing is decided
 * here. The words are always "by these checks": it never says that an app is
 * secure, safe, certified or guaranteed, in English or in Roman Urdu.
 */

/** Said in the limits when the roadmap could not be made. */
export const ROADMAP_NOT_AVAILABLE: Text = {
  en: 'Roadmap not available.',
  ur: 'Roadmap maujood nahi.',
};

export const CLIENT_REPORT_DISCLAIMER: Text = {
  en: 'This is the result of automated checks only, and it holds only "by these checks": it says nothing about what was not checked (see the scope). It is not an approval of the app.',
  ur: 'Ye sirf automatic checks ka nateeja hai aur sirf "in checks ke hisab se" hai: jo cheez check nahi hui uske bare mein ye kuch nahi kehta (scope dekhein). Ye app ki manzoori nahi hai.',
};

const DATA_ACCESS = 'data-access-prover';
const SITE_CHECKS = ['tls-headers', 'bundle-secrets'];
const REPO_CHECK = 'repo-secrets';

export interface ClientReportInput {
  plan: readonly PlannedCheck[];
  evidence: readonly EvidenceItem[];
  coverage: Coverage;
  gate: Gate;
  /** null = the Roadmap step was not available */
  roadmap: Roadmap | null;
}

const entry = (check: PlannedCheck): ScopeEntry => ({
  id: check.id,
  title: check.title,
});

function headlineOf(
  gate: Gate,
  tables: { leaked: number } | null,
  site: { siteLeaked: number } | null,
  anyDone: boolean,
  repoLeaks = 0,
): Text {
  const tableLeaks = tables?.leaked ?? 0;
  const keyLeaks = site?.siteLeaked ?? 0;
  if (tableLeaks > 0 || keyLeaks > 0 || repoLeaks > 0) {
    const en: string[] = [];
    const ur: string[] = [];
    if (tableLeaks > 0) {
      en.push(`${tableLeaks} table${tableLeaks === 1 ? '' : 's'}`);
      ur.push(`${tableLeaks} table`);
    }
    if (keyLeaks > 0) {
      en.push(
        `${keyLeaks} secret key${keyLeaks === 1 ? '' : 's'} in the scripts of the site`,
      );
      ur.push(`site ki scripts mein ${keyLeaks} secret key`);
    }
    if (repoLeaks > 0) {
      en.push(
        `${repoLeaks} secret key${repoLeaks === 1 ? '' : 's'} in the files of the GitHub repository`,
      );
      ur.push(`GitHub repository ki files mein ${repoLeaks} secret key`);
    }
    return {
      en: `Leak found by these checks: ${en.join(' and ')}.`,
      ur: `In checks se leak mila: ${ur.join(' aur ')}.`,
    };
  }
  if (gate.decision === 'ready_by_these_checks') {
    return {
      en: 'No leak found by these checks.',
      ur: 'In checks se koi leak nahi mila.',
    };
  }
  if (!anyDone) {
    return {
      en: 'No result by these checks: no check finished.',
      ur: 'In checks se koi nateeja nahi: koi check poora nahi hua.',
    };
  }
  return {
    en: 'No leak found so far by these checks, but the result is not complete.',
    ur: 'In checks se ab tak koi leak nahi mila, lekin nateeja mukammal nahi.',
  };
}

export function buildClientReport(input: ClientReportInput): ClientReport {
  const { plan, evidence, coverage, gate, roadmap } = input;

  const scope: ClientReport['scope'] = {
    checked: [],
    notProvided: [],
    notImplemented: [],
    partial: [],
    failedToRun: [],
    outOfScope: coverage.outOfScope.map((o) => ({
      name: o.name,
      reason: o.reason,
    })),
  };
  // Every planned check goes into exactly one list.
  for (const check of plan) {
    if (coverage.checked.includes(check.id)) {
      scope.checked.push(entry(check));
    } else if (coverage.partial.some((c) => c.id === check.id)) {
      scope.partial.push(entry(check));
    } else if (coverage.failedToRun.some((c) => c.id === check.id)) {
      scope.failedToRun.push(entry(check));
    } else if (
      coverage.skipped.some(
        (c) => c.id === check.id && c.reason.en.startsWith('Not provided'),
      )
    ) {
      scope.notProvided.push(entry(check));
    } else {
      scope.notImplemented.push(entry(check));
    }
  }

  const tableItems = evidence.filter(
    (e) => e.check === DATA_ACCESS && (e.kind === undefined || e.kind === 'table'),
  );
  const count = (items: readonly EvidenceItem[], verdict: string) =>
    items.filter((e) => e.verdict === verdict).length;
  const tables = coverage.checked.includes(DATA_ACCESS)
    ? {
        leaked: count(tableItems, 'LEAKED'),
        blocked: count(tableItems, 'BLOCKED'),
        inconclusive: count(tableItems, 'INCONCLUSIVE'),
      }
    : null;
  const siteRan = SITE_CHECKS.some(
    (id) =>
      coverage.checked.includes(id) ||
      coverage.partial.some((c) => c.id === id),
  );
  const site = siteRan
    ? {
        siteLeaked: evidence.filter(
          (e) => e.kind === 'site-bundle' && e.verdict === 'LEAKED',
        ).length,
        headersMissing: evidence.filter(
          (e) => e.kind === 'site-headers' && e.verdict === 'INCONCLUSIVE',
        ).length,
      }
    : null;

  // Only a run that has the repo check: the field is missing for every other run.
  const hasRepo = plan.some((c) => c.id === REPO_CHECK);
  const repoRan =
    coverage.checked.includes(REPO_CHECK) ||
    coverage.partial.some((c) => c.id === REPO_CHECK);
  const repo = repoRan
    ? {
        leaked: evidence.filter(
          (e) => e.kind === 'repo-file' && e.verdict === 'LEAKED',
        ).length,
      }
    : null;

  return {
    schemaVersion: 1,
    headline: headlineOf(
      gate,
      tables,
      site,
      coverage.checked.length > 0 || coverage.partial.length > 0,
      repo?.leaked ?? 0,
    ),
    decision: gate.decision,
    reasons: gate.reasons,
    scope,
    findings: { tables, site, ...(hasRepo ? { repo } : {}) },
    topActions: (roadmap?.items ?? []).slice(0, 3).map((item) => item.id),
    limits: roadmap
      ? [...coverage.limits]
      : [...coverage.limits, ROADMAP_NOT_AVAILABLE],
    disclaimer: CLIENT_REPORT_DISCLAIMER,
  };
}

/** The report of a run whose Guide was not available: fixed, and never ready. */
export function failSafeClientReport(): ClientReport {
  return {
    schemaVersion: 1,
    headline: {
      en: 'No result by these checks: the result of this run could not be worked out.',
      ur: 'In checks se koi nateeja nahi: is run ka nateeja nikala nahi ja saka.',
    },
    decision: 'not_ready',
    reasons: [GATE_UNAVAILABLE],
    scope: {
      checked: [],
      notProvided: [],
      notImplemented: [],
      partial: [],
      failedToRun: [],
      outOfScope: [],
    },
    findings: { tables: null, site: null },
    topActions: [],
    limits: [ROADMAP_NOT_AVAILABLE],
    disclaimer: CLIENT_REPORT_DISCLAIMER,
  };
}
