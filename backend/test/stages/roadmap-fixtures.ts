import { buildFinding } from '../../src/prover/findings.js';
import type { Finding } from '../../src/prover/types.js';
import { buildCoverage, buildEvidence } from '../../src/stages/evidence.js';
import { evaluateGate } from '../../src/stages/gate.js';
import { collectResults, type StageInput } from '../../src/stages/inspectors.js';
import { CHECKS } from '../../src/stages/planner-config.js';
import { planRun } from '../../src/stages/planner.js';
import type {
  CheckResult,
  Coverage,
  EvidenceItem,
  Gate,
  PlannedCheck,
  Provided,
} from '../../src/stages/types.js';

export interface StageFixture {
  plan: PlannedCheck[];
  findings: Finding[];
  evidence: EvidenceItem[];
  coverage: Coverage;
  gate: Gate;
  cleanup: 'ok' | 'failed' | null;
  provided: Provided;
}

/** A real finding, made by the same code the Prover uses. */
export function finding(
  id: string,
  table: string,
  verdict: 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE',
): Finding {
  return buildFinding(id, {
    table,
    ownerColumn: 'user_id',
    verdict,
    operation: 'SELECT',
    httpStatus: 200,
    rowsReturned: verdict === 'LEAKED' ? 1 : 0,
    canaryRowId: 'row-1',
    ownerValue: 'owner-1',
    culprit: 'user',
    reason: verdict === 'INCONCLUSIVE' ? 'owner-blocked' : undefined,
    operations: [],
  });
}

const HEADER_SUBJECTS = [
  'https',
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'framing',
  'referrer-policy',
] as const;

/** Header evidence, as the headers inspector writes it. `missing` = INCONCLUSIVE. */
export function headerItems(
  missing: readonly string[] = [],
): EvidenceItem[] {
  return HEADER_SUBJECTS.map((subject, i) => ({
    id: `ev_site_tls-headers_${i + 1}`,
    check: 'tls-headers',
    findingId: null,
    table: null,
    subject,
    kind: 'site-headers' as const,
    verdict: missing.includes(subject)
      ? ('INCONCLUSIVE' as const)
      : ('BLOCKED' as const),
    proof: 'PROVEN' as const,
    summary: { en: `header ${subject}`, ur: `header ${subject} (ur)` },
  }));
}

export function bundleItem(n: number, subject: string): EvidenceItem {
  return {
    id: `ev_site_bundle-secrets_${n}`,
    check: 'bundle-secrets',
    findingId: null,
    table: null,
    subject,
    kind: 'site-bundle',
    verdict: 'LEAKED',
    proof: 'PROVEN',
    summary: { en: 'A secret key is in a script.', ur: 'Script mein secret key hai.' },
  };
}

export interface FixtureOptions {
  provided: Provided;
  findings?: Finding[];
  cleanup?: 'ok' | 'failed' | null;
  siteEvidence?: EvidenceItem[];
  siteResults?: Record<string, CheckResult>;
}

/** The stage result of a run, worked out by the real stage code. */
export function makeFixture(options: FixtureOptions): StageFixture {
  const { provided } = options;
  const findings = options.findings ?? [];
  const cleanup = options.cleanup ?? (provided.supabase ? 'ok' : null);
  const { plan } = planRun(CHECKS, provided);
  const input: StageInput = {
    findings,
    cleanup,
    dataAccess: provided.supabase
      ? { status: 'completed', zeroTables: findings.length === 0 }
      : { status: 'notProvided' },
    provided,
    ...(options.siteResults ? { siteResults: options.siteResults } : {}),
  };
  const results = collectResults(CHECKS, input);
  const evidence = [...buildEvidence(findings), ...(options.siteEvidence ?? [])];
  const coverage = buildCoverage(CHECKS, results);
  const gate = evaluateGate({
    plan,
    coverage,
    evidence,
    cleanup,
    notProvided: CHECKS.filter(
      (c) => c.needs && !provided[c.needs],
    ).map((c) => ({ id: c.id, title: c.title })),
  });
  return { plan, findings, evidence, coverage, gate, cleanup, provided };
}

const siteCompleted = (
  extra: Partial<CheckResult> = {},
): Record<string, CheckResult> => ({
  'tls-headers': {
    id: 'tls-headers',
    status: 'completed',
    outOfScope: [
      {
        name: 'TLS validity period and expiry',
        reason: { en: 'Not implemented yet.', ur: 'Abhi bana nahi.' },
      },
    ],
  },
  'bundle-secrets': { id: 'bundle-secrets', status: 'completed', ...extra },
});

/** 1. Supabase details only: a leak, a held-up table and an unclear one. */
export function supabaseOnly(): StageFixture {
  return makeFixture({
    provided: { supabase: true, website: false },
    findings: [
      finding('fnd_001', 'bookings', 'LEAKED'),
      finding('fnd_002', 'profiles', 'BLOCKED'),
      finding('fnd_003', 'hotels', 'INCONCLUSIVE'),
    ],
  });
}

/** 2. A website only: a secret key in a script and weak headers. */
export function urlOnly(): StageFixture {
  return makeFixture({
    provided: { supabase: false, website: true },
    siteEvidence: [
      ...headerItems([
        'strict-transport-security',
        'content-security-policy',
        'x-content-type-options',
        'referrer-policy',
      ]),
      bundleItem(1, 'www.example-shop.com/assets/app.js'),
    ],
    siteResults: siteCompleted(),
  });
}

/** 3. Both: a table leak, a failed cleanup, a script that was not read. */
export function both(): StageFixture {
  return makeFixture({
    provided: { supabase: true, website: true },
    findings: [
      finding('fnd_001', 'bookings', 'LEAKED'),
      finding('fnd_002', 'profiles', 'BLOCKED'),
    ],
    cleanup: 'failed',
    siteEvidence: [...headerItems(['https']), bundleItem(1, 'cdn.example-shop.com/a.js')],
    siteResults: {
      ...siteCompleted(),
      'bundle-secrets': {
        id: 'bundle-secrets',
        status: 'partial',
        reason: { en: 'Some scripts were not read.', ur: 'Kuch scripts nahi parhi gayin.' },
        notRead: [
          {
            name: 'www.example-shop.com/big.js',
            reason: { en: 'Too big.', ur: 'Bahut bari.' },
          },
          {
            name: 'www.example-shop.com/slow.js',
            reason: { en: 'Time limit.', ur: 'Waqt khatam.' },
          },
        ],
        outOfScope: [
          {
            name: 'cdn.other.com/lib.js',
            reason: { en: 'Another origin.', ur: 'Doosra origin.' },
          },
        ],
      },
    },
  });
}

/** 4. A Prover that failed to run (Supabase given). */
export function proverFailed(): StageFixture {
  const provided = { supabase: true, website: false };
  const { plan } = planRun(CHECKS, provided);
  const input: StageInput = {
    findings: [],
    cleanup: null,
    dataAccess: { status: 'failedToRun', message: 'The data access check did not finish.' },
    provided,
  };
  const coverage = buildCoverage(CHECKS, collectResults(CHECKS, input));
  const gate = evaluateGate({ plan, coverage, evidence: [], cleanup: null });
  return { plan, findings: [], evidence: [], coverage, gate, cleanup: null, provided };
}

export const ALL_FIXTURES: Record<string, () => StageFixture> = {
  'supabase-only': supabaseOnly,
  'url-only': urlOnly,
  both,
  'prover-failed': proverFailed,
};

/** The words that must never appear as a claim of approval (English and Roman Urdu). */
export const BANNED_EN = /\b(certified|safe to launch|guaranteed|secure)\b/i;
export const BANNED_UR = /(mehfooz|surakshit|zamanat)/i;

/** Every string in a value, deeply. */
export function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

/** A small seeded shuffle, so the tests are the same on every run. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed * 2654435761 + 1;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
