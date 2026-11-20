import { isIP } from 'node:net';
import { ApiError } from '../common/api-error.js';

/**
 * What POST /audits asks for, after checking. A website, a Supabase project,
 * or both: at least one. (AuditInput below is the old shape: Supabase only.)
 */
export interface AuditRequest {
  label: string;
  /** The front page of the site (an origin), or null. */
  websiteUrl: string | null;
  /** A public GitHub repository to read (Repo Scan), when one was given. */
  repo?: { owner: string; repo: string; url: string };
  /** The whole Supabase group, or null: it is never half there. */
  supabase: {
    projectUrl: string;
    publishableKey: string;
    secretKey: string;
  } | null;
}

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

export interface RetestInput {
  publishableKey: string;
  secretKey: string;
}

/**
 * Checks the POST /audits/:id/retest body. The keys are sent again every time
 * because the backend never stores them. projectUrl is refused: the address
 * saved with the audit is always used, so keys cannot be pointed elsewhere.
 */
export function parseRetestInput(body: unknown): RetestInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid('Send a JSON object.');
  }
  const b = body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(b, 'projectUrl')) {
    throw invalid(
      'projectUrl is not accepted for a re-test. The address saved with the audit is always used.',
    );
  }
  if (b.confirmTestProject !== true) {
    throw invalid(
      'Confirm this is a TEST project: set confirmTestProject to true.',
    );
  }
  return {
    publishableKey: parseKey(b.anonKey, 'anonKey'),
    secretKey: parseKey(b.serviceKey, 'serviceKey'),
  };
}

const WEBSITE_MESSAGE =
  'websiteUrl must look like https://www.example.com (a public https address, no login).';

function parseWebsiteUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw invalid(WEBSITE_MESSAGE);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid(WEBSITE_MESSAGE);
  }
  const host = url.hostname;
  const plain =
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    host.length <= 253 &&
    // a public name has a dot; an IP address or a single word (localhost,
    // intranet) is refused here, and the network guard checks again later
    host.includes('.') &&
    isIP(host) === 0;
  if (!plain) throw invalid(WEBSITE_MESSAGE);
  return url.origin; // only the front page is looked at
}

const REPO_MESSAGE =
  'repoUrl must look like https://github.com/owner/repo (a public repository, no login, no path after the name).';
const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

function parseRepoUrl(value: unknown): {
  owner: string;
  repo: string;
  url: string;
} {
  if (typeof value !== 'string' || value.length > 300) {
    throw invalid(REPO_MESSAGE);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid(REPO_MESSAGE);
  }
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const owner = parts[1] ?? '';
  const repo = (parts[2] ?? '').replace(/\.git$/, '');
  const plain =
    url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    parts.length === 3 &&
    REPO_NAME.test(owner) &&
    REPO_NAME.test(repo) &&
    owner !== '.' &&
    owner !== '..' &&
    repo !== '.' &&
    repo !== '..';
  if (!plain) throw invalid(REPO_MESSAGE);
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

const SUPABASE_GROUP = ['projectUrl', 'anonKey', 'serviceKey'] as const;

export function requestOf(input: AuditInput): AuditRequest {
  return {
    label: input.label,
    websiteUrl: null,
    supabase: {
      projectUrl: input.projectUrl,
      publishableKey: input.publishableKey,
      secretKey: input.secretKey,
    },
  };
}

/**
 * Checks the POST /audits body. `websiteEnabled` is the LOCK_C_AGENTS flag.
 *
 * Flag off, or a body without `websiteUrl`: the old parser, the old messages,
 * exactly as before (a `websiteUrl` with the flag off is ignored like any
 * other extra field).
 *
 * Flag on and `websiteUrl` given: the website needs `confirmSiteAccess: true`.
 * The Supabase group (projectUrl, anonKey, serviceKey) is optional, but all or
 * nothing, and with it `confirmTestProject: true` is needed as before. The
 * messages name fields only, never a value.
 */
export function parseAuditRequest(
  body: unknown,
  websiteEnabled: boolean,
): AuditRequest {
  const isObject =
    typeof body === 'object' && body !== null && !Array.isArray(body);
  const has = (field: string) =>
    isObject && Object.prototype.hasOwnProperty.call(body, field);
  if (!websiteEnabled || !(has('websiteUrl') || has('repoUrl'))) {
    return requestOf(parseAuditInput(body));
  }
  const b = body as Record<string, unknown>;
  // The website is optional when a repository is given (Repo Scan).
  let websiteUrl: string | null = null;
  if (has('websiteUrl')) {
    websiteUrl = parseWebsiteUrl(b.websiteUrl);
    if (b.confirmSiteAccess !== true) {
      throw invalid(
        'Confirm you may test this site: set confirmSiteAccess to true.',
      );
    }
  }
  const repo = has('repoUrl') ? parseRepoUrl(b.repoUrl) : null;

  const given = SUPABASE_GROUP.filter((field) => b[field] !== undefined);
  let supabase: AuditRequest['supabase'] = null;
  if (given.length > 0) {
    const missing = SUPABASE_GROUP.filter((field) => !given.includes(field));
    if (missing.length > 0) {
      throw invalid(
        `Give all the Supabase details or none. Missing: ${missing.join(', ')}.`,
      );
    }
    if (b.confirmTestProject !== true) {
      throw invalid(
        'Confirm this is a TEST project: set confirmTestProject to true.',
      );
    }
    supabase = {
      projectUrl: parseProjectUrl(b.projectUrl),
      publishableKey: parseKey(b.anonKey, 'anonKey'),
      secretKey: parseKey(b.serviceKey, 'serviceKey'),
    };
  }

  let label = websiteUrl
    ? new URL(websiteUrl).hostname
    : `${repo!.owner}/${repo!.repo}`;
  if (b.label !== undefined) {
    if (typeof b.label !== 'string' || b.label.length > MAX_LABEL_LENGTH) {
      throw invalid(
        `label must be text of at most ${MAX_LABEL_LENGTH} characters.`,
      );
    }
    if (b.label.trim()) label = b.label.trim();
  }
  return { label, websiteUrl, supabase, ...(repo ? { repo } : {}) };
}
