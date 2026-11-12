import { ApiError } from './errors';
import { initialMockFindings, retestedMockFindings } from './mock-data';
import type {
  AuditStatusResponse,
  Certificate,
  Finding,
  FindingsResponse,
  StartAuditInput,
  StartAuditResponse,
} from './types';

const MOCK_AUDIT_ID = 'aud_mock_001';
const RUN_MS = 4_500;
const RETEST_MS = 2_600;
const RECORD_HASH =
  '5b0f7a3d9c1e8f2a4b6d8e0f1a3c5e7b9d1f3a5c7e9b0d2f4a6c8e0b1d3f5a7c';

interface MockState {
  startedAt: number;
  findings: Finding[];
  retestStartedAt: number | null;
  retestFinishedAt: number | null;
}

let state: MockState | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureState(): MockState {
  if (!state) {
    state = {
      startedAt: Date.now() - RUN_MS - 1_000,
      findings: initialMockFindings(),
      retestStartedAt: null,
      retestFinishedAt: null,
    };
  }
  return state;
}

function applyFinishedRetest(current: MockState): void {
  if (
    current.retestStartedAt !== null &&
    current.retestFinishedAt === null &&
    Date.now() - current.retestStartedAt >= RETEST_MS
  ) {
    const ranAt = new Date().toISOString();
    current.findings = retestedMockFindings(ranAt);
    current.retestFinishedAt = Date.now();
  }
}

function findMockAudit(id: string): MockState {
  if (id !== MOCK_AUDIT_ID) {
    throw new ApiError(404, 'NOT_FOUND', 'No audit with this id was found.');
  }
  return ensureState();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function summaryOf(findings: Finding[]) {
  const count = (verdict: Finding['verdict']) =>
    findings.filter((finding) => finding.verdict === verdict).length;
  return {
    leaked: count('LEAKED'),
    blocked: count('BLOCKED'),
    inconclusive: count('INCONCLUSIVE'),
  };
}

export async function mockStartAudit(
  input: StartAuditInput,
): Promise<StartAuditResponse> {
  await delay(350);
  state = {
    startedAt: Date.now(),
    findings: initialMockFindings(),
    retestStartedAt: null,
    retestFinishedAt: null,
  };
  if (input.projectUrl.length === 0) {
    throw new ApiError(400, 'INVALID_INPUT', 'projectUrl is required.');
  }
  return { id: MOCK_AUDIT_ID, status: 'running' };
}

export async function mockGetAudit(id: string): Promise<AuditStatusResponse> {
  await delay(180);
  const current = findMockAudit(id);
  applyFinishedRetest(current);

  const retestRunning =
    current.retestStartedAt !== null && current.retestFinishedAt === null;
  const firstRunElapsed = Date.now() - current.startedAt;
  const firstRunRunning = firstRunElapsed < RUN_MS;

  const running = retestRunning || firstRunRunning;
  const progress = retestRunning
    ? 70
    : firstRunRunning
      ? Math.min(95, Math.round((firstRunElapsed / RUN_MS) * 100))
      : 100;

  return {
    id: MOCK_AUDIT_ID,
    status: running ? 'running' : 'completed',
    createdAt: new Date(current.startedAt).toISOString(),
    target: {
      label: 'Mock hotel booking (test project)',
      projectUrl: 'https://example-project.supabase.co',
    },
    summary: running
      ? { leaked: 0, blocked: 0, inconclusive: 0 }
      : summaryOf(current.findings),
    modules: [
      {
        id: 'data-access-prover',
        name: 'Data Access Prover',
        status: running ? 'running' : 'completed',
        progress,
      },
    ],
    cleanup: running ? null : 'ok',
  };
}

export async function mockGetFindings(id: string): Promise<FindingsResponse> {
  await delay(180);
  const current = findMockAudit(id);
  applyFinishedRetest(current);
  const running =
    Date.now() - current.startedAt < RUN_MS ||
    (current.retestStartedAt !== null && current.retestFinishedAt === null);
  return { findings: running ? [] : clone(current.findings) };
}

export async function mockApproveFix(
  id: string,
  findingId: string,
): Promise<Finding> {
  await delay(320);
  const current = findMockAudit(id);
  const finding = current.findings.find((item) => item.id === findingId);
  if (!finding) {
    throw new ApiError(404, 'NOT_FOUND', 'No finding with this id was found.');
  }
  if (!finding.fix) {
    throw new ApiError(400, 'INVALID_INPUT', 'This finding has no fix.');
  }
  finding.fix = { ...finding.fix, status: 'approved' };
  return clone(finding);
}

export async function mockRetest(
  id: string,
): Promise<StartAuditResponse> {
  await delay(320);
  const current = findMockAudit(id);
  applyFinishedRetest(current);
  current.retestStartedAt = Date.now();
  current.retestFinishedAt = null;
  current.findings = current.findings.map((finding) => ({
    ...finding,
    retest: { ...finding.retest, status: 'running' },
  }));
  return { id: MOCK_AUDIT_ID, status: 'running' };
}

export async function mockGetCertificate(id: string): Promise<Certificate> {
  await delay(300);
  const current = findMockAudit(id);
  applyFinishedRetest(current);

  if (current.findings.some((finding) => finding.verdict === 'LEAKED')) {
    throw new ApiError(
      409,
      'NOT_ELIGIBLE',
      'This audit still has a LEAKED finding. Fix it and run the re-test first.',
    );
  }
  if (current.retestFinishedAt === null) {
    throw new ApiError(
      409,
      'NOT_ELIGIBLE',
      'Run the re-test after applying the fix. The certificate is available when the re-test passes.',
    );
  }

  return {
    auditId: MOCK_AUDIT_ID,
    issuedAt: new Date(current.retestFinishedAt).toISOString(),
    result: 'NO_LEAK_FOUND_BY_THESE_CHECKS',
    checksRun: ['data-access-prover'],
    disclaimer:
      'This is evidence that specific checks passed. It is not a guarantee that the app is secure.',
    recordHash: RECORD_HASH,
  };
}
