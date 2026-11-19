// Mock mode, the bundles of the agent pipeline (docs/frontend-mock/).
//
// Open the app with NEXT_PUBLIC_USE_MOCK=true and add ?mock=<name> to the
// address of the Connect screen:
//   ?mock=supabase-only   an audit of a Supabase project, with the stages
//   ?mock=url-only        an audit of a website
//   ?mock=both            website and Supabase
//   ?mock=timeout         a run that ran out of time (a failed row, TIMEOUT)
// Without it the old mock of R1 to R70 is used (the answers of a backend with
// LOCK_C_AGENTS off). The name is kept in the tab (sessionStorage), and the
// audit id carries it ("mock-both"), so a reload or a link to the Report keeps it.
//
// The JSON files in ./mock-bundles are copies of docs/frontend-mock (a test
// compares them, so they cannot drift). They hold no key and no real address.
import bothAudit from './mock-bundles/both/audit.json';
import bothClient from './mock-bundles/both/client-report.json';
import bothEvidence from './mock-bundles/both/evidence.json';
import bothFindings from './mock-bundles/both/findings.json';
import bothRoadmap from './mock-bundles/both/roadmap.json';
import supabaseAudit from './mock-bundles/supabase-only/audit.json';
import supabaseClient from './mock-bundles/supabase-only/client-report.json';
import supabaseEvidence from './mock-bundles/supabase-only/evidence.json';
import supabaseFindings from './mock-bundles/supabase-only/findings.json';
import supabaseRoadmap from './mock-bundles/supabase-only/roadmap.json';
import urlAudit from './mock-bundles/url-only/audit.json';
import urlClient from './mock-bundles/url-only/client-report.json';
import urlEvidence from './mock-bundles/url-only/evidence.json';
import urlFindings from './mock-bundles/url-only/findings.json';
import urlRoadmap from './mock-bundles/url-only/roadmap.json';
import { ApiError } from './errors';
import type {
  ClientReport,
  EvidenceResponse,
  RoadmapResponse,
} from './stage-types';
import type {
  AuditModule,
  AuditStatusResponse,
  FindingsResponse,
  StartAuditInput,
  StartAuditResponse,
} from './types';

export const BUNDLE_NAMES = [
  'supabase-only',
  'url-only',
  'both',
  'timeout',
] as const;
export type BundleName = (typeof BUNDLE_NAMES)[number];

const ID_PREFIX = 'mock-';
const STORAGE_KEY = 'vca-mock-bundle';
const RUN_MS = 6_000;

interface Bundle {
  audit: AuditStatusResponse;
  findings: FindingsResponse;
  /** null = the route answers 404: this audit has none (R72). */
  evidence: EvidenceResponse | null;
  roadmap: RoadmapResponse | null;
  clientReport: ClientReport | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const FILES = {
  'supabase-only': {
    audit: supabaseAudit,
    evidence: supabaseEvidence,
    roadmap: supabaseRoadmap,
    clientReport: supabaseClient,
    findings: supabaseFindings,
  },
  'url-only': {
    audit: urlAudit,
    evidence: urlEvidence,
    roadmap: urlRoadmap,
    clientReport: urlClient,
    findings: urlFindings,
  },
  both: {
    audit: bothAudit,
    evidence: bothEvidence,
    roadmap: bothRoadmap,
    clientReport: bothClient,
    findings: bothFindings,
  },
} as const;

/** A run that ran out of time (R75, R85, R86), made from the "both" files. */
function timeoutBundle(): Bundle {
  const audit = clone(bothAudit) as unknown as AuditStatusResponse;
  audit.status = 'failed';
  audit.summary = { leaked: 0, blocked: 0, inconclusive: 0, siteLeaked: 1 };
  audit.error = {
    code: 'TIMEOUT',
    message: 'The audit reached its time limit and was stopped.',
  };
  audit.cleanup = 'failed';
  audit.cleanupNote =
    'The temporary test users may still be in the test project. Remove them by hand.';
  audit.modules = audit.modules.map((row) =>
    row.id === 'data-access-prover'
      ? {
          id: row.id,
          name: row.name,
          status: 'failed',
          progress: 40,
          message: 'This step took too long and was stopped.',
        }
      : row,
  );
  return {
    audit,
    findings: { findings: [] },
    // a failed run can have them (R86); the mock leaves them out: "404 = hide"
    evidence: null,
    roadmap: null,
    clientReport: null,
  };
}

function bundleOf(name: BundleName): Bundle {
  if (name === 'timeout') return timeoutBundle();
  const files = FILES[name];
  return {
    audit: clone(files.audit) as unknown as AuditStatusResponse,
    findings: clone(files.findings) as unknown as FindingsResponse,
    evidence: clone(files.evidence) as unknown as EvidenceResponse,
    roadmap: clone(files.roadmap) as unknown as RoadmapResponse,
    clientReport: clone(files.clientReport) as unknown as ClientReport,
  };
}

export function isBundleName(value: unknown): value is BundleName {
  return (
    typeof value === 'string' && (BUNDLE_NAMES as readonly string[]).includes(value)
  );
}

export function bundleIdOf(name: BundleName): string {
  return `${ID_PREFIX}${name}`;
}

/** The bundle an audit id belongs to, or null (the old mock, or an unknown id). */
export function bundleFromId(id: string): BundleName | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  const name = id.slice(ID_PREFIX.length);
  return isBundleName(name) ? name : null;
}

/**
 * The bundle chosen for this tab: ?mock=<name> in the address, kept in
 * sessionStorage. null = the old mock. Browser only; false answers are safe.
 */
export function selectedBundle(): BundleName | null {
  if (typeof window === 'undefined') return null;
  try {
    const query = new URLSearchParams(window.location.search).get('mock');
    if (isBundleName(query)) {
      window.sessionStorage.setItem(STORAGE_KEY, query);
      return query;
    }
    if (query === 'old') {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const kept = window.sessionStorage.getItem(STORAGE_KEY);
    return isBundleName(kept) ? kept : null;
  } catch {
    return null;
  }
}

// ---- when each run started, to play the progress screen once ----
const startedAt = new Map<string, number>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function bundleStartAudit(
  name: BundleName,
  input: StartAuditInput,
): Promise<StartAuditResponse> {
  await delay(350);
  // The messages of the backend name the field, never a value (R76).
  if (input.websiteUrl !== undefined && !/^https:\/\//i.test(input.websiteUrl)) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'websiteUrl must be a public https address.',
    );
  }
  const id = bundleIdOf(name);
  startedAt.set(id, Date.now());
  return { id, status: 'running' };
}

function playRun(audit: AuditStatusResponse, elapsed: number): AuditStatusResponse {
  const share = Math.min(1, elapsed / RUN_MS);
  const rows = audit.modules.filter((row) => row.status !== 'skipped');
  const modules: AuditModule[] = audit.modules.map((row) => {
    if (row.status === 'skipped') return row;
    const index = rows.indexOf(row);
    const from = (index / rows.length) * 0.8;
    const to = from + 0.35;
    if (share <= from) {
      return { id: row.id, name: row.name, status: 'queued', progress: 0 };
    }
    if (share >= to) return { ...row, status: 'completed', progress: 100 };
    return {
      id: row.id,
      name: row.name,
      status: 'running',
      progress: Math.round(((share - from) / (to - from)) * 90),
    };
  });
  return {
    id: audit.id,
    status: 'running',
    createdAt: audit.createdAt,
    target: audit.target,
    summary: { leaked: 0, blocked: 0, inconclusive: 0 },
    modules,
    cleanup: null,
    lastRetest: null,
  };
}

function find(id: string): { bundle: Bundle; elapsed: number } {
  const name = bundleFromId(id);
  if (!name) {
    throw new ApiError(404, 'NOT_FOUND', 'No audit with this id was found.');
  }
  const bundle = bundleOf(name);
  bundle.audit.id = id;
  // an id that was not started in this page (a reload, a link) is finished
  const started = startedAt.get(id);
  return { bundle, elapsed: started === undefined ? RUN_MS : Date.now() - started };
}

export async function bundleGetAudit(id: string): Promise<AuditStatusResponse> {
  await delay(150);
  const { bundle, elapsed } = find(id);
  return elapsed < RUN_MS ? playRun(bundle.audit, elapsed) : bundle.audit;
}

export async function bundleGetFindings(id: string): Promise<FindingsResponse> {
  await delay(150);
  const { bundle, elapsed } = find(id);
  return elapsed < RUN_MS ? { findings: [] } : bundle.findings;
}

function none(): never {
  throw new ApiError(404, 'NOT_FOUND', 'This audit has none.');
}

export async function bundleGetEvidence(id: string): Promise<EvidenceResponse> {
  await delay(120);
  return find(id).bundle.evidence ?? none();
}

export async function bundleGetRoadmap(id: string): Promise<RoadmapResponse> {
  await delay(120);
  return find(id).bundle.roadmap ?? none();
}

export async function bundleGetClientReport(id: string): Promise<ClientReport> {
  await delay(120);
  return find(id).bundle.clientReport ?? none();
}

/** Re-test, Approve fix and the re-test result are not played for the bundles. */
export function bundleNotPlayed(): never {
  throw new ApiError(
    409,
    'NOT_ELIGIBLE',
    'This action is not played in the preview of the stage bundles. Use the default mock for it.',
  );
}
