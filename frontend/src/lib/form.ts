// The rules of the Connect form (docs/frontend-brief.md R76). Pure functions:
// the page calls them, and the tests load them.
//
// Three optional groups, at least one complete:
//  - Website: websiteUrl + the box "I may test this site" (confirmSiteAccess);
//  - Supabase: projectUrl + publishable key + secret key, all three together,
//    + the TEST project box (confirmTestProject);
//  - Public GitHub repo: repoUrl + the box "This repository is public and I may
//    scan its files" (confirmRepoAccess).
// A half-filled group blocks the start (the backend would answer 400) and the
// note names what is missing. The UI never sends a half group.
import type { Lang } from './check-labels';
import type { StartAuditInput } from './types';

export interface ConnectFields {
  label: string;
  websiteUrl: string;
  confirmSiteAccess: boolean;
  projectUrl: string;
  anonKey: string;
  serviceKey: string;
  confirmTestProject: boolean;
  repoUrl: string;
  confirmRepoAccess: boolean;
}

export const EMPTY_FIELDS: ConnectFields = {
  label: '',
  websiteUrl: '',
  confirmSiteAccess: false,
  projectUrl: '',
  anonKey: '',
  serviceKey: '',
  confirmTestProject: false,
  repoUrl: '',
  confirmRepoAccess: false,
};

/** empty: nothing in it. partial: something is missing. complete: all there. */
export type GroupState = 'empty' | 'partial' | 'complete';

export interface GroupCheck {
  state: GroupState;
  /** What is missing, in words, for a partial group. */
  missing: string[];
}

export interface ConnectCheck {
  website: GroupCheck;
  supabase: GroupCheck;
  repo: GroupCheck;
  /** Start is possible (the access code is not part of this). */
  canStart: boolean;
}

function filled(value: string): boolean {
  return value.trim().length > 0;
}

function groupOf(parts: [string, boolean][]): GroupCheck {
  const any = parts.some(([, has]) => has);
  const missing = parts.filter(([, has]) => !has).map(([name]) => name);
  if (!any) return { state: 'empty', missing: [] };
  return missing.length === 0
    ? { state: 'complete', missing: [] }
    : { state: 'partial', missing };
}

/** The message under the repository field when the address is not accepted. */
export const REPO_URL_PROBLEM =
  'Use exactly https://github.com/owner/repo: https only, github.com only, no path after the name, no ?query or #part.';

const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * The ONE rule for the repository address, the same as the backend's
 * parseRepoUrl (backend/src/audits/audit-input.ts): https, github.com (the host
 * is lower-cased by the URL parser, as in the backend), exactly owner/repo, one
 * trailing slash and a trailing .git allowed, no port, login, ?query or #part.
 * A change here needs the same change there (a spec compares them).
 */
export function isValidRepoUrl(value: string): boolean {
  if (value.length > 300) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const owner = parts[1] ?? '';
  const repo = (parts[2] ?? '').replace(/\.git$/, '');
  return (
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
    repo !== '..'
  );
}

const REPO_URL_PROBLEM_UR =
  'Bilkul https://github.com/owner/repo likhein: sirf https, sirf github.com, naam ke baad koi path nahi, aur ?query ya #hissa nahi.';

/** The inline message for the field: empty while it is empty or valid. */
export function repoUrlProblem(value: string, lang: Lang = 'en'): string {
  if (!filled(value) || isValidRepoUrl(value)) return '';
  return lang === 'ur' ? REPO_URL_PROBLEM_UR : REPO_URL_PROBLEM;
}

export function checkConnect(fields: ConnectFields): ConnectCheck {
  const website = groupOf([
    ['Website address', filled(fields.websiteUrl)],
    ['the box "I may test this site"', fields.confirmSiteAccess],
  ]);
  const supabase = groupOf([
    ['Project URL', filled(fields.projectUrl)],
    ['Publishable key', filled(fields.anonKey)],
    ['Secret key', filled(fields.serviceKey)],
    ['the TEST project box', fields.confirmTestProject],
  ]);
  const repoBox = ['the box "This repository is public and I may scan its files"', fields.confirmRepoAccess] as [string, boolean];
  let repo = groupOf([
    ['Repository address', filled(fields.repoUrl)],
    repoBox,
  ]);
  // a filled address counts only when the backend would accept it: a wrong
  // one keeps the group at "Needs more" (never "Ready", never "Not used")
  if (filled(fields.repoUrl) && !isValidRepoUrl(fields.repoUrl)) {
    repo = {
      state: 'partial',
      missing: ['a valid repository address (https://github.com/owner/repo)', ...(fields.confirmRepoAccess ? [] : [repoBox[0]])],
    };
  }
  const groups = [website, supabase, repo];
  const oneComplete = groups.some((g) => g.state === 'complete');
  const nonePartial = groups.every((g) => g.state !== 'partial');
  return { website, supabase, repo, canStart: oneComplete && nonePartial };
}

// The Roman Urdu names of what a group can miss (checkConnect names them in English).
const MISSING_UR: Record<string, string> = {
  'Website address': 'Website ka address',
  'the box "I may test this site"': 'site test karne ki ijazat wala box',
  'Project URL': 'Project URL',
  'Publishable key': 'Publishable key',
  'Secret key': 'Secret key',
  'the TEST project box': 'TEST project wala box',
  'Repository address': 'Repository ka address',
  'the box "This repository is public and I may scan its files"':
    'files scan karne ki ijazat wala box',
  'a valid repository address (https://github.com/owner/repo)':
    'sahi repository address (https://github.com/owner/repo)',
};

/**
 * A short note for the start button: what to do next. Empty when nothing is
 * missing. It names fields only, never a value.
 */
export function startNote(check: ConnectCheck, lang: Lang = 'en'): string {
  const list = (missing: string[]) =>
    (lang === 'ur' ? missing.map((m) => MISSING_UR[m] ?? m) : missing).join(', ');
  const notes: string[] = [];
  if (check.website.state === 'partial') {
    notes.push(`Website: ${list(check.website.missing)}`);
  }
  if (check.supabase.state === 'partial') {
    notes.push(`Supabase: ${list(check.supabase.missing)}`);
  }
  if (check.repo.state === 'partial') {
    notes.push(`Repository: ${list(check.repo.missing)}`);
  }
  if (notes.length > 0) {
    return lang === 'ur'
      ? `Ye hissa poora karein ya khali karein: ${notes.join('. ')}.`
      : `Finish or clear a group: ${notes.join('. ')}.`;
  }
  if (!check.canStart) {
    // The repository box is the first thing on the page, so it is named first;
    // a live website is the other way in.
    return lang === 'ur'
      ? 'Public GitHub repo ka link paste karein aur files scan karne ki ijazat wala box lagayein, ya live website jodein.'
      : 'Paste a public GitHub repo link and tick the box "This repository is public and I may scan its files", or add a live website.';
  }
  return '';
}

/** The line under the start button: the access code and what a group still needs. */
export function startHintOf(
  check: ConnectCheck,
  hasAccessCode: boolean,
  lang: Lang = 'en',
): string {
  const code =
    lang === 'ur' ? 'access code likhein' : 'enter the access code';
  const parts = [hasAccessCode ? '' : code, startNote(check, lang)]
    .filter(Boolean)
    .map((part) => part.replace(/\.$/, ''));
  if (parts.length === 0) return '';
  const lead = lang === 'ur' ? 'Shuru karne ke liye' : 'To start';
  return `${lead}: ${parts.join('. ')}.`;
}

/**
 * "Will check: repo + website": built from the groups that are complete, which
 * are exactly the ones buildStartBody sends. Empty when none is complete.
 */
export function willCheckLine(check: ConnectCheck, lang: Lang = 'en'): string {
  const names = [
    check.repo.state === 'complete' ? 'repo' : '',
    check.website.state === 'complete' ? 'website' : '',
    check.supabase.state === 'complete' ? 'Supabase test project' : '',
  ].filter(Boolean);
  if (names.length === 0) return '';
  return `${lang === 'ur' ? 'Ye check honge' : 'Will check'}: ${names.join(' + ')}`;
}

/**
 * The words of the one start button. It names the repository alone until the
 * website part is opened; with anything typed in the Supabase part it names
 * neither, and the "Will check" line says what will run.
 */
export function startButtonLabel(
  check: ConnectCheck,
  websiteOpen: boolean,
  lang: Lang = 'en',
): string {
  if (check.supabase.state !== 'empty') {
    return lang === 'ur' ? 'Ye checks chalayein' : 'Run these checks';
  }
  if (websiteOpen) {
    return lang === 'ur' ? 'Repo + website check karein' : 'Check repo + website';
  }
  return lang === 'ur' ? 'Ye repo check karein' : 'Check this repo';
}

/**
 * The body of POST /audits (R76). Only a complete group is sent: a website
 * with `confirmSiteAccess: true`, a Supabase project with `confirmTestProject:
 * true`, a repository with `confirmRepoAccess: true`. A request without a
 * repository is exactly as before (no `repoUrl`, no `confirmRepoAccess`). A
 * website-only request has no `confirmTestProject`. The keys are sent as typed;
 * they are never trimmed or logged.
 */
export function buildStartBody(fields: ConnectFields): StartAuditInput {
  const check = checkConnect(fields);
  const body: StartAuditInput = {};
  if (filled(fields.label)) body.label = fields.label.trim();
  if (check.website.state === 'complete') {
    body.websiteUrl = fields.websiteUrl.trim();
    body.confirmSiteAccess = true;
  }
  if (check.supabase.state === 'complete') {
    body.projectUrl = fields.projectUrl.trim();
    body.anonKey = fields.anonKey;
    body.serviceKey = fields.serviceKey;
    body.confirmTestProject = true;
  }
  if (check.repo.state === 'complete') {
    body.repoUrl = fields.repoUrl.trim();
    body.confirmRepoAccess = true;
  }
  return body;
}

/** After a 202 the keys are cleared (R29). The website address and the boxes may stay. */
export function clearKeys(fields: ConnectFields): ConnectFields {
  return { ...fields, anonKey: '', serviceKey: '' };
}
