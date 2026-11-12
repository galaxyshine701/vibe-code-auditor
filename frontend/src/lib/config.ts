const DEFAULT_API_BASE_URL = 'http://localhost:4000';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
).replace(/\/+$/, '');

export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== 'false';

export const NETWORK_ERROR_MESSAGE =
  'Cannot reach the server. Check your connection and try again.';

export const DISCLAIMER =
  'This is evidence that specific checks passed. It is not a guarantee that the app is secure.';

export const REQUEST_TIMEOUT_MS = 20_000;
