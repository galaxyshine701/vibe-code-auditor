import { NETWORK_ERROR_MESSAGE } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class NetworkError extends Error {
  constructor() {
    super(NETWORK_ERROR_MESSAGE);
    this.name = 'NetworkError';
  }
}

export class RequestCancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'RequestCancelledError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
