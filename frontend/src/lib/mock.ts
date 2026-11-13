import { ApiError } from './errors';
import { initialMockFindings, retestedMockFindings } from './mock-data';
import type {
  AuditStatusResponse,
  Certificate,
  Finding,
  FindingsResponse,
  LastRetest,
  RetestInput,
  StartAuditInput,
  StartAuditResponse,
} from './types';

const MOCK_AUDIT_ID = 'aud_mock_001';
const RUN_MS = 4_500;
const RETEST_MS = 2_600;
const RECORD_HASH =
  '5b0f7a3d9c1e8f2a4b6d8e0f1a3c5e7b9d1f3a5c7e9b0d2f4a6c8e0b1d3f5a7c';
// Test hook, mock mode only: a Re-test sent with this secret key fails (R51).
const FAIL_RETEST_KEY = 'fail-retest';

interface MockState {
  startedAt: number;
  findings: Finding[];
  /** set while a Re-test is running */
  retest: { startedAt: number; willFail: boolean } | null;
  lastRetest: LastRetest | null;
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
      retest: null,
      lastRetest: null,
    };
  }
  return state;
}

function applyFinishedRetest(current: MockState): void {
  if (!current.retest || Date.now() - current.retest.startedAt < RETEST_MS) {
    return;
  }
  const startedAt = new Date(current.retest.startedAt).toISOString();
  const finishedAt = new Date().toISOString();
  if (current.retest.willFail) {
    // A failed Re-test keeps the findings from before (R51).
    current.lastRetest = {
      status: 'failed',
      startedAt,
      finishedAt,
      tablesAdded: [],
      tablesRemoved: [],
      error: {
        code: 'PROVER_FAILED',
        message: 'The Re-test could not log in to the test project.',
      },
    };
  } else {
    current.findings = retestedMockFindings(finishedAt);
    current.lastRetest = {
      status: 'completed',
      startedAt,
      finishedAt,
      tablesAdded: [],
      tablesRemoved: [],
      error: null,
    };
  }
  current.retest = null;
}

function findMockAudit(id: string): MockState {
  if (id !== MOCK_AUDIT_ID) {
    throw new ApiError(404, 'NOT_FOUND', 'No audit with this id was found.');
  }
  const current = ensureState();
  applyFinishedRetest(current);
  return current;
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

function firstRunRunning(current: MockState): boolean {
  return Date.now() - current.startedAt < RUN_MS;
}

function inProgress(): ApiError {
  return new ApiError(
    409,
    'AUDIT_IN_PROGRESS',
    'Another audit is still running. Wait until it finishes, then try again.',
  );
}

export async function mockStartAudit(
  input: StartAuditInput,
): Promise<StartAuditResponse> {
  await delay(350);
  state = {
    startedAt: Date.now(),
    findings: initialMockFindings(),
    retest: null,
    lastRetest: null,
  };
  if (input.projectUrl.length === 0) {
    throw new ApiError(400, 'INVALID_INPUT', 'projectUrl is required.');
  }
  return { id: MOCK_AUDIT_ID, status: 'running' };
}

export async function mockGetAudit(id: string): Promise<AuditStatusResponse> {
  await delay(180);
  const current = findMockAudit(id);

  const retestRunning = current.retest !== null;
  const firstRunElapsed = Date.now() - current.startedAt;
  const firstRun = firstRunRunning(current);

  const running = retestRunning || firstRun;
  const progress = retestRunning
    ? 70
    : firstRun
      ? Math.min(95, Math.round((firstRunElapsed / RUN_MS) * 100))
      : 100;

  const lastRetest: LastRetest | null = current.retest
    ? {
        status: 'running',
        startedAt: new Date(current.retest.startedAt).toISOString(),
        finishedAt: null,
        tablesAdded: [],
        tablesRemoved: [],
        error: null,
      }
    : current.lastRetest;

  return {
    id: MOCK_AUDIT_ID,
    status: running ? 'running' : 'completed',
    createdAt: new Date(current.startedAt).toISOString(),
    target: {
      label: 'Mock hotel booking (test project)',
      projectUrl: 'https://example-project.supabase.co',
    },
    // During a Re-test the summary still counts the findings from before.
    summary: firstRun
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
    cleanup: firstRun ? null : 'ok',
    lastRetest,
  };
}

export async function mockGetFindings(id: string): Promise<FindingsResponse> {
  await delay(180);
  const current = findMockAudit(id);
  if (firstRunRunning(current)) return { findings: [] };
  const findings = clone(current.findings);
  if (current.retest) {
    // During a Re-test the old findings stay, each marked "running" (R50).
    for (const finding of findings) finding.retest.status = 'running';
  }
  return { findings };
}

export async function mockApproveFix(
  id: string,
  findingId: string,
): Promise<Finding> {
  await delay(320);
  const current = findMockAudit(id);
  if (firstRunRunning(current) || current.retest) throw inProgress();
  const finding = current.findings.find((item) => item.id === findingId);
  if (!finding) {
    throw new ApiError(404, 'NOT_FOUND', 'No finding with this id was found.');
  }
  if (!finding.fix) {
    throw new ApiError(
      409,
      'NO_FIX_TO_APPROVE',
      'This finding has no suggested fix to approve.',
    );
  }
  finding.fix = { ...finding.fix, status: 'approved' };
  return clone(finding);
}

export async function mockRetest(
  id: string,
  input: RetestInput,
): Promise<StartAuditResponse> {
  await delay(320);
  const current = findMockAudit(id);
  if ('projectUrl' in input) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'projectUrl is not accepted for a re-test. The address saved with the audit is always used.',
    );
  }
  if (input.confirmTestProject !== true) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'Confirm this is a TEST project: set confirmTestProject to true.',
    );
  }
  if (!input.anonKey.trim()) {
    throw new ApiError(400, 'INVALID_INPUT', 'anonKey is required.');
  }
  if (!input.serviceKey.trim()) {
    throw new ApiError(400, 'INVALID_INPUT', 'serviceKey is required.');
  }
  if (firstRunRunning(current) || current.retest) throw inProgress();
  current.retest = {
    startedAt: Date.now(),
    willFail: input.serviceKey === FAIL_RETEST_KEY,
  };
  return { id: MOCK_AUDIT_ID, status: 'running' };
}

export async function mockGetCertificate(id: string): Promise<Certificate> {
  await delay(300);
  const current = findMockAudit(id);

  // The same rule as the backend (R35).
  if (firstRunRunning(current) || current.retest) {
    throw new ApiError(
      409,
      'NOT_ELIGIBLE',
      'The audit or a re-test is still running. Wait until it has finished.',
    );
  }
  const summary = summaryOf(current.findings);
  if (summary.leaked > 0) {
    throw new ApiError(
      409,
      'NOT_ELIGIBLE',
      'A leak was found and is still there. Fix it, then run a re-test.',
    );
  }
  if (summary.blocked === 0) {
    throw new ApiError(
      409,
      'NOT_ELIGIBLE',
      'No table was shown to be blocked, so no result can be issued.',
    );
  }

  const issuedAt =
    current.lastRetest?.status === 'completed' && current.lastRetest.finishedAt
      ? current.lastRetest.finishedAt
      : new Date(current.startedAt + RUN_MS).toISOString();

  return {
    auditId: MOCK_AUDIT_ID,
    issuedAt,
    result: 'NO_LEAK_FOUND_BY_THESE_CHECKS',
    checksRun: ['data-access-prover'],
    summary: { blocked: summary.blocked, inconclusive: summary.inconclusive },
    disclaimer:
      'This is evidence that specific checks passed. It is not a guarantee that the app is secure.',
    recordHash: RECORD_HASH,
  };
}
