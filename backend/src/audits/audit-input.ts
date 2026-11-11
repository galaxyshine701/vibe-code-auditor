import { ApiError } from '../common/api-error.js';

export interface AuditInput {
  label: string;
  /** Always the plain origin, for example https://abcdefgh.supabase.co */
  projectUrl: string;
  publishableKey: string;
  secretKey: string;
}

const MAX_KEY_LENGTH = 4096;
const MAX_LABEL_LENGTH = 120;
// exactly one label in front of .supabase.co
const SUPABASE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.supabase\.co$/;

const invalid = (message: string) =>
  new ApiError(400, 'INVALID_INPUT', message);

/**
 * Checks the POST /audits body by hand (no library), so no error text can
 * ever quote a value. Messages name the field only, never its content.
 */
export function parseAuditInput(body: unknown): AuditInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid('Send a JSON object.');
  }
  const b = body as Record<string, unknown>;

  // The caller must say it is a test project. The server's own settings are
  // deliberately not consulted.
  if (b.confirmTestProject !== true) {
    throw invalid(
      'Confirm this is a TEST project: set confirmTestProject to true.',
    );
  }

  const projectUrl = parseProjectUrl(b.projectUrl);
  const publishableKey = parseKey(b.anonKey, 'anonKey');
  const secretKey = parseKey(b.serviceKey, 'serviceKey');

  let label = projectUrl.replace('https://', '');
  if (b.label !== undefined) {
    if (typeof b.label !== 'string' || b.label.length > MAX_LABEL_LENGTH) {
      throw invalid(
        `label must be text of at most ${MAX_LABEL_LENGTH} characters.`,
      );
    }
    if (b.label.trim()) label = b.label.trim();
  }
  return { label, projectUrl, publishableKey, secretKey };
}

function parseProjectUrl(value: unknown): string {
  const message =
    'projectUrl must look like https://<project-ref>.supabase.co (no port, path or login).';
  if (typeof value !== 'string') throw invalid(message);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid(message);
  }
  const plain =
    url.protocol === 'https:' &&
    SUPABASE_HOST.test(url.hostname) &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '';
  if (!plain) throw invalid(message);
  return url.origin;
}

function parseKey(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_KEY_LENGTH
  ) {
    throw invalid(`${field} is required.`);
  }
  return value.trim();
}
