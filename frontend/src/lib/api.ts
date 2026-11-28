import { API_BASE_URL, REQUEST_TIMEOUT_MS, USE_MOCK } from './config';
import {
  ApiError,
  NetworkError,
  RequestCancelledError,
} from './errors';
import type {
  ClientReport,
  EvidenceResponse,
  RoadmapResponse,
  StageBundle,
} from './stage-types';
import type {
  AuditStatusResponse,
  Certificate,
  Finding,
  FindingsResponse,
  RetestInput,
  StartAuditInput,
  StartAuditResponse,
} from './types';

// The sample data is a part of its own, loaded only when the preview with sample
// data (USE_MOCK) asks for it: a visitor of the real app never downloads it.
const sample = () => import('./mock');
const bundles = () => import('./mock-bundle');

/** The sample bundle this id belongs to, or null (also: not the preview). */
async function sampleOf(id: string) {
  return USE_MOCK ? (await bundles()).bundleFromId(id) : null;
}

// A field that older answers do not have is treated as null (R46).
function normalizeFinding(finding: Finding): Finding {
  return {
    ...finding,
    retest: {
      ...finding.retest,
      previousVerdict: finding.retest.previousVerdict ?? null,
    },
  };
}

function normalizeAudit(audit: AuditStatusResponse): AuditStatusResponse {
  return {
    ...audit,
    lastRetest: audit.lastRetest ?? null,
    // a missing schemaVersion means 1: no stage fields (R72)
    schemaVersion: audit.schemaVersion ?? 1,
  };
}

// The three routes of the stages answer 404 for an audit that has none (it was
// run with the flag off, or before these features). That is "hide", not an
// error to show (R72). Any other error is thrown as usual.
async function orNone<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function normalizeCertificate(certificate: Certificate): Certificate {
  return { ...certificate, summary: certificate.summary ?? null };
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get('Retry-After');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  const diff = Math.ceil((date - Date.now()) / 1_000);
  return diff > 0 ? diff : null;
}

async function request<T>(
  path: string,
  accessCode: string,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Access-Code': accessCode,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const body = data as ErrorBody | null;
      const code = body?.error?.code ?? 'UNKNOWN';
      const message =
        body?.error?.message ?? `The server answered with status ${response.status}.`;
      throw new ApiError(
        response.status,
        code,
        message,
        response.status === 429 ? retryAfterSeconds(response) : null,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw new RequestCancelledError();
    if (error instanceof Error && error.name === 'AbortError' && timedOut) {
      throw new NetworkError();
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RequestCancelledError();
    }
    throw new NetworkError();
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function startAudit(
  input: StartAuditInput,
  accessCode: string,
  signal?: AbortSignal,
): Promise<StartAuditResponse> {
  if (USE_MOCK) {
    const sets = await bundles();
    const bundle = sets.selectedBundle();
    return bundle
      ? sets.bundleStartAudit(bundle, input)
      : (await sample()).mockStartAudit(input);
  }
  return request<StartAuditResponse>('/api/v1/audits', accessCode, {
    method: 'POST',
    body: input,
    signal,
  });
}

export async function getAudit(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<AuditStatusResponse> {
  const bundle = await sampleOf(id);
  const audit = bundle
    ? await (await bundles()).bundleGetAudit(id)
    : USE_MOCK
    ? await (await sample()).mockGetAudit(id)
    : await request<AuditStatusResponse>(
        `/api/v1/audits/${encodeURIComponent(id)}`,
        accessCode,
        { signal },
      );
  return normalizeAudit(audit);
}

export async function getFindings(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<FindingsResponse> {
  const bundle = await sampleOf(id);
  const result = bundle
    ? await (await bundles()).bundleGetFindings(id)
    : USE_MOCK
    ? await (await sample()).mockGetFindings(id)
    : await request<FindingsResponse>(
        `/api/v1/audits/${encodeURIComponent(id)}/findings`,
        accessCode,
        { signal },
      );
  return { findings: result.findings.map(normalizeFinding) };
}

export async function approveFix(
  id: string,
  findingId: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<Finding> {
  if (await sampleOf(id)) (await bundles()).bundleNotPlayed();
  const finding = USE_MOCK
    ? await (await sample()).mockApproveFix(id, findingId)
    : await request<Finding>(
        `/api/v1/audits/${encodeURIComponent(id)}/findings/${encodeURIComponent(findingId)}/fix/approve`,
        accessCode,
        { method: 'POST', signal },
      );
  return normalizeFinding(finding);
}

// The keys are sent again on every Re-test. projectUrl is never sent (R33).
export async function retest(
  id: string,
  input: RetestInput,
  accessCode: string,
  signal?: AbortSignal,
): Promise<StartAuditResponse> {
  const body: RetestInput = {
    anonKey: input.anonKey,
    serviceKey: input.serviceKey,
    confirmTestProject: true,
  };
  if (await sampleOf(id)) (await bundles()).bundleNotPlayed();
  if (USE_MOCK) return (await sample()).mockRetest(id, body);
  return request<StartAuditResponse>(
    `/api/v1/audits/${encodeURIComponent(id)}/retest`,
    accessCode,
    { method: 'POST', body, signal },
  );
}

export async function getCertificate(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<Certificate> {
  if (await sampleOf(id)) (await bundles()).bundleNotPlayed();
  const certificate = USE_MOCK
    ? await (await sample()).mockGetCertificate(id)
    : await request<Certificate>(
        `/api/v1/audits/${encodeURIComponent(id)}/certificate`,
        accessCode,
        { signal },
      );
  return normalizeCertificate(certificate);
}

/** GET /audits/:id/evidence. null = this audit has none (404). */
export async function getEvidence(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<EvidenceResponse | null> {
  return orNone(async () =>
    (await sampleOf(id))
      ? (await bundles()).bundleGetEvidence(id)
      : USE_MOCK
        ? Promise.reject(new ApiError(404, 'NOT_FOUND', 'No evidence.'))
        : request<EvidenceResponse>(
            `/api/v1/audits/${encodeURIComponent(id)}/evidence`,
            accessCode,
            { signal },
          ),
  );
}

/** GET /audits/:id/roadmap. null = this audit has none (404). */
export async function getRoadmap(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<RoadmapResponse | null> {
  return orNone(async () =>
    (await sampleOf(id))
      ? (await bundles()).bundleGetRoadmap(id)
      : USE_MOCK
        ? Promise.reject(new ApiError(404, 'NOT_FOUND', 'No roadmap.'))
        : request<RoadmapResponse>(
            `/api/v1/audits/${encodeURIComponent(id)}/roadmap`,
            accessCode,
            { signal },
          ),
  );
}

/** GET /audits/:id/client-report. null = this audit has none (404). */
export async function getClientReport(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<ClientReport | null> {
  return orNone(async () =>
    (await sampleOf(id))
      ? (await bundles()).bundleGetClientReport(id)
      : USE_MOCK
        ? Promise.reject(new ApiError(404, 'NOT_FOUND', 'No client report.'))
        : request<ClientReport>(
            `/api/v1/audits/${encodeURIComponent(id)}/client-report`,
            accessCode,
            { signal },
          ),
  );
}

/**
 * The three stage routes of a finished run, read together (R72, R84). Called
 * only for an audit with schemaVersion 2 or more; with the flag off none of
 * the three is asked for. Each part is null when its route answers 404.
 */
export async function getStageBundle(
  audit: AuditStatusResponse,
  accessCode: string,
  signal?: AbortSignal,
): Promise<StageBundle> {
  if ((audit.schemaVersion ?? 1) < 2) {
    return { evidence: null, roadmap: null, clientReport: null };
  }
  const [evidence, roadmap, clientReport] = await Promise.all([
    getEvidence(audit.id, accessCode, signal),
    getRoadmap(audit.id, accessCode, signal),
    getClientReport(audit.id, accessCode, signal),
  ]);
  return { evidence, roadmap, clientReport };
}
