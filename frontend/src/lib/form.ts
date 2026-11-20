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
  const repo = groupOf([
    ['Repository address', filled(fields.repoUrl)],
    ['the box "This repository is public and I may scan its files"', fields.confirmRepoAccess],
  ]);
  const groups = [website, supabase, repo];
  const oneComplete = groups.some((g) => g.state === 'complete');
  const nonePartial = groups.every((g) => g.state !== 'partial');
  return { website, supabase, repo, canStart: oneComplete && nonePartial };
}

/**
 * A short note for the start button: what to do next. Empty when nothing is
 * missing. It names fields only, never a value.
 */
export function startNote(check: ConnectCheck): string {
  const notes: string[] = [];
  if (check.website.state === 'partial') {
    notes.push(`Website: ${check.website.missing.join(', ')}`);
  }
  if (check.supabase.state === 'partial') {
    notes.push(`Supabase: ${check.supabase.missing.join(', ')}`);
  }
  if (check.repo.state === 'partial') {
    notes.push(`Repository: ${check.repo.missing.join(', ')}`);
  }
  if (notes.length > 0) return `Finish or clear a group: ${notes.join('. ')}.`;
  if (!check.canStart) {
    return 'Complete the website group, the Supabase group, the repository group, or more than one.';
  }
  return '';
}

/** The line under the start button: the access code and what a group still needs. */
export function startHintOf(check: ConnectCheck, hasAccessCode: boolean): string {
  const parts = [hasAccessCode ? '' : 'enter the access code', startNote(check)]
    .filter(Boolean)
    .map((part) => part.replace(/\.$/, ''));
  return parts.length > 0 ? `To start: ${parts.join('. ')}.` : '';
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
