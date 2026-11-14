import { COVERAGE } from './coverage';

const DEFAULT_API_BASE_URL = 'http://localhost:4000';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
).replace(/\/+$/, '');

// Mock mode is off unless it is switched on explicitly (R43).
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

export const NETWORK_ERROR_MESSAGE =
  'Cannot reach the server. Check your connection and try again.';

export const DISCLAIMER = COVERAGE.statement;

export const REQUEST_TIMEOUT_MS = 20_000;
