import { API_BASE_URL, REQUEST_TIMEOUT_MS, USE_MOCK } from './config';
import {
  ApiError,
  NetworkError,
  RequestCancelledError,
} from './errors';
import {
  mockApproveFix,
  mockGetAudit,
  mockGetCertificate,
  mockGetFindings,
  mockRetest,
  mockStartAudit,
} from './mock';
import type {
  AuditStatusResponse,
  Certificate,
  Finding,
  FindingsResponse,
  StartAuditInput,
  StartAuditResponse,
} from './types';

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
  if (USE_MOCK) return mockStartAudit(input);
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
  if (USE_MOCK) return mockGetAudit(id);
  return request<AuditStatusResponse>(
    `/api/v1/audits/${encodeURIComponent(id)}`,
    accessCode,
    { signal },
  );
}

export async function getFindings(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<FindingsResponse> {
  if (USE_MOCK) return mockGetFindings(id);
  return request<FindingsResponse>(
    `/api/v1/audits/${encodeURIComponent(id)}/findings`,
    accessCode,
    { signal },
  );
}

export async function approveFix(
  id: string,
  findingId: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<Finding> {
  if (USE_MOCK) return mockApproveFix(id, findingId);
  return request<Finding>(
    `/api/v1/audits/${encodeURIComponent(id)}/findings/${encodeURIComponent(findingId)}/fix/approve`,
    accessCode,
    { method: 'POST', signal },
  );
}

export async function retest(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<StartAuditResponse> {
  if (USE_MOCK) return mockRetest(id);
  return request<StartAuditResponse>(
    `/api/v1/audits/${encodeURIComponent(id)}/retest`,
    accessCode,
    { method: 'POST', signal },
  );
}

export async function getCertificate(
  id: string,
  accessCode: string,
  signal?: AbortSignal,
): Promise<Certificate> {
  if (USE_MOCK) return mockGetCertificate(id);
  return request<Certificate>(
    `/api/v1/audits/${encodeURIComponent(id)}/certificate`,
    accessCode,
    { signal },
  );
}
