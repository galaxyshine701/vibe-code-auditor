// Pure helpers for the Report of the agent pipeline (docs/frontend-brief.md R73
// to R83). No React, no fetch: the pages call these, and the tests load them.
//
// The rules that live here:
//  - the verdict, the gate and the severity come from the API, never from the UI.
//    The helpers read them and pass them on; the only "work" is the formula the
//    brief itself gives for the headline when there is no client report (R73);
//  - a field can be missing, a value can be unknown: nothing here throws (R72).
import type { Lang } from './check-labels';
import type {
  ClientReport,
  Coverage,
  CoveragePartial,
  CoverageOutOfScope,
  EvidenceItem,
  RoadmapItem,
  Text,
} from './stage-types';
import type { AuditStatusResponse } from './types';

/** A text in the chosen language; a missing "ur" falls back to English (R82). */
export function pick(text: Text | undefined | null, lang: Lang): string {
  if (!text) return '';
  return (lang === 'ur' ? text.ur : text.en) || text.en || '';
}

/**
 * How many files the Repo scan read, exactly as the API sent it. null when the
 * API sent no count (nothing is guessed or counted here).
 */
export function repoFilesRead(coverage: Coverage | null | undefined): number | null {
  const entry = coverage?.filesRead?.find((item) => item.id === 'repo-secrets');
  return entry && Number.isInteger(entry.count) && entry.count >= 0
    ? entry.count
    : null;
}

/** True when the audit has the stage fields (R72). A higher version: show what is known. */
export function hasStages(audit: Pick<AuditStatusResponse, 'schemaVersion'>): boolean {
  return (audit.schemaVersion ?? 1) >= 2;
}

// ---- R73: the headline ----

export type HeadlineTone = 'leak' | 'clear' | 'not-ready';

export interface Headline {
  text: Text;
  tone: HeadlineTone;
}

const OWN_HEADLINE = {
  leak: {
    en: 'Leak found by these checks.',
    ur: 'In checks se leak mila.',
  },
  clear: {
    en: 'No leak found by these checks.',
    ur: 'In checks se koi leak nahi mila.',
  },
  notReady: {
    en: 'Not ready: see why.',
    ur: 'Abhi tayyar nahi: wajah dekhein.',
  },
} as const;

/**
 * Leaks in tables, secret keys in the scripts of the site, and secret keys in
 * the files of the repository. siteLeaked and repoLeaked missing = 0.
 */
export function leakCount(
  summary: AuditStatusResponse['summary'] | undefined,
): number {
  return (
    (summary?.leaked ?? 0) +
    (summary?.siteLeaked ?? 0) +
    (summary?.repoLeaked ?? 0)
  );
}

/**
 * The headline of a result (R73). It is never `summary.leaked` alone:
 * 1. `clientReport.headline` when there is one (its words are the backend's);
 * 2. otherwise a leak (tables + site) is a leak;
 * 3. no leak is "No leak found by these checks." ONLY when the gate says
 *    `ready_by_these_checks`;
 * 4. no gate (schemaVersion 1): null, the old screens keep their own headline.
 */
export function headlineOf(
  audit: Pick<AuditStatusResponse, 'summary' | 'gate'>,
  clientReport: ClientReport | null | undefined,
): Headline | null {
  const leaks = leakCount(audit.summary);
  const decision = clientReport?.decision ?? audit.gate?.decision;
  const tone: HeadlineTone =
    leaks > 0
      ? 'leak'
      : decision === 'ready_by_these_checks'
        ? 'clear'
        : 'not-ready';
  if (clientReport?.headline?.en) {
    return { text: clientReport.headline, tone };
  }
  if (leaks > 0) return { text: OWN_HEADLINE.leak, tone: 'leak' };
  if (audit.gate?.decision === 'ready_by_these_checks') {
    return { text: OWN_HEADLINE.clear, tone: 'clear' };
  }
  if (audit.gate) return { text: OWN_HEADLINE.notReady, tone: 'not-ready' };
  return null;
}

// ---- R78: the buckets of coverage ----

export interface BucketCheck {
  id: string;
  reason?: Text;
  /** From plan[].required. A required check that is not checked keeps the gate at not_ready. */
  required?: boolean;
}

export interface Buckets {
  checked: BucketCheck[];
  partial: (BucketCheck & Pick<CoveragePartial, 'notRead'>)[];
  notProvided: BucketCheck[];
  notImplemented: BucketCheck[];
  failedToRun: BucketCheck[];
  outOfScope: CoverageOutOfScope[];
  limits: Text[];
  /** Where "Not provided" and "Not implemented" came from (R78 and its fallback). */
  source: 'client-report' | 'coverage';
}

function startsWithNotProvided(text: Text | undefined): boolean {
  return /^\s*not provided/i.test(text?.en ?? '');
}

/**
 * The buckets of R78, each on its own, never merged. "Not provided" and "Not
 * implemented yet" are told apart by `clientReport.scope`; only when there is
 * no client report (404) does the start of the `reason` decide. null when
 * there is neither a client report nor a coverage.
 */
export function bucketsOf(
  clientReport: ClientReport | null | undefined,
  coverage: Coverage | null | undefined,
  plan?: { id: string; required?: boolean }[],
): Buckets | null {
  if (!clientReport?.scope && !coverage) return null;

  const required = new Map((plan ?? []).map((c) => [c.id, c.required === true]));
  const reasonOf = new Map<string, Text | undefined>();
  for (const item of [
    ...(coverage?.skipped ?? []),
    ...(coverage?.failedToRun ?? []),
    ...(coverage?.partial ?? []),
  ]) {
    reasonOf.set(item.id, item.reason);
  }
  const make = (id: string): BucketCheck => ({
    id,
    reason: reasonOf.get(id),
    required: required.get(id),
  });

  const scope = clientReport?.scope;
  let checked: string[];
  let notProvided: string[];
  let notImplemented: string[];
  let failedToRun: string[];
  let partialIds: string[];
  let outOfScope: CoverageOutOfScope[];
  let source: Buckets['source'];

  if (scope) {
    source = 'client-report';
    checked = (scope.checked ?? []).map((c) => c.id);
    notProvided = (scope.notProvided ?? []).map((c) => c.id);
    notImplemented = (scope.notImplemented ?? []).map((c) => c.id);
    failedToRun = (scope.failedToRun ?? []).map((c) => c.id);
    partialIds = (scope.partial ?? []).map((c) => c.id);
    outOfScope = scope.outOfScope ?? coverage?.outOfScope ?? [];
  } else {
    // Fallback only: no client report (R78).
    source = 'coverage';
    const skipped = coverage?.skipped ?? [];
    checked = coverage?.checked ?? [];
    notProvided = skipped.filter((s) => startsWithNotProvided(s.reason)).map((s) => s.id);
    notImplemented = skipped.filter((s) => !startsWithNotProvided(s.reason)).map((s) => s.id);
    failedToRun = (coverage?.failedToRun ?? []).map((s) => s.id);
    partialIds = (coverage?.partial ?? []).map((s) => s.id);
    outOfScope = coverage?.outOfScope ?? [];
  }

  const partialDetail = new Map((coverage?.partial ?? []).map((p) => [p.id, p]));
  return {
    checked: checked.map(make),
    partial: partialIds.map((id) => ({
      ...make(id),
      notRead: partialDetail.get(id)?.notRead ?? [],
    })),
    notProvided: notProvided.map(make),
    notImplemented: notImplemented.map(make),
    failedToRun: failedToRun.map(make),
    outOfScope,
    limits: coverage?.limits?.length ? coverage.limits : (clientReport?.limits ?? []),
    source,
  };
}

// ---- R79: evidence grouped by kind ----

export interface EvidenceGroup {
  kind: string;
  items: EvidenceItem[];
}

const KIND_ORDER = ['table', 'site-headers', 'site-bundle', 'repo-file', 'repo-test-key', 'repo-env-name', 'repo-migration'];

/** A missing `kind` is "table". The order of the items inside a group is kept. */
export function kindOf(item: EvidenceItem): string {
  return item.kind || 'table';
}

export function groupEvidence(items: EvidenceItem[] | undefined | null): EvidenceGroup[] {
  const groups = new Map<string, EvidenceItem[]>();
  for (const item of items ?? []) {
    const kind = kindOf(item);
    groups.set(kind, [...(groups.get(kind) ?? []), item]);
  }
  const known = KIND_ORDER.filter((k) => groups.has(k));
  const others = [...groups.keys()].filter((k) => !KIND_ORDER.includes(k));
  return [...known, ...others].map((kind) => ({
    kind,
    items: groups.get(kind) ?? [],
  }));
}

// ---- R74, R83: what the screen offers, by what the audit has ----

/** Re-test and the re-test result need Supabase details (R74). */
export function canRetest(audit: Pick<AuditStatusResponse, 'target'>): boolean {
  return Boolean(audit.target?.projectUrl);
}

/** An audit of Supabase only: the screen invites to add a website (R83). */
export function invitesWebsite(audit: Pick<AuditStatusResponse, 'target' | 'schemaVersion'>): boolean {
  return hasStages(audit) && Boolean(audit.target?.projectUrl) && !audit.target?.websiteUrl;
}

/** An audit with no Supabase project (a website, a repository, or both): no table was checked. */
export function noTableCheck(audit: Pick<AuditStatusResponse, 'target'>): boolean {
  return !audit.target?.projectUrl;
}

/** An audit of a website only: no table was checked (R83). */
export function websiteOnly(audit: Pick<AuditStatusResponse, 'target'>): boolean {
  return Boolean(audit.target?.websiteUrl) && !audit.target?.projectUrl;
}

// ---- R81: the roadmap ----

/** The "Required check" label is only on fix-* and improve-header items (R81). */
export function showsRequiredLabel(item: Pick<RoadmapItem, 'kind' | 'fromRequiredCheck'>): boolean {
  return (
    item.fromRequiredCheck === true &&
    (item.kind.startsWith('fix-') ||
      item.kind === 'improve-header' ||
      item.kind === 'improve-repo')
  );
}

/** The roadmap in the order it came: never sorted again (R81). */
export function roadmapItems(items: RoadmapItem[] | undefined | null): RoadmapItem[] {
  return items ? [...items] : [];
}

/** The first items the client report points at (R80), found by id, in its order. */
export function topActionItems(
  report: ClientReport | null | undefined,
  items: RoadmapItem[] | undefined | null,
): RoadmapItem[] {
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  return (report?.topActions ?? [])
    .map((id) => byId.get(id))
    .filter((i): i is RoadmapItem => Boolean(i));
}

/** The roadmap could not be made (R80): the limits say so and no steps are shown. */
export function roadmapUnavailable(report: ClientReport | null | undefined): boolean {
  return (report?.limits ?? []).some((l) => /roadmap not available/i.test(l.en));
}
