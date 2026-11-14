import { createHash } from 'node:crypto';
import type { Finding } from '../prover/types.js';

export const CERTIFICATE_RESULT = 'NO_LEAK_FOUND_BY_THESE_CHECKS';
export const CERTIFICATE_DISCLAIMER =
  'This result covers table data access only: read, update and delete as another signed-in user, and read as a visitor.';

/** What the certificate needs to know about an audit. No keys, ever. */
export interface CertificateSubject {
  id: string;
  label: string;
  projectUrl: string;
  createdAt: string;
  status: string;
  findings: Finding[];
  cleanup: 'ok' | 'failed' | null;
  /** when the latest completed run (audit or re-test) finished */
  completedAt: string | null;
  lastRetest: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    tablesAdded: string[];
    tablesRemoved: string[];
  } | null;
}

const count = (findings: Finding[], verdict: string) =>
  findings.filter((f) => f.verdict === verdict).length;

/**
 * Why there is no certificate yet, or null when there may be one. ALL must hold:
 * the audit is completed, zero LEAKED, at least one BLOCKED, cleanup not "failed".
 */
export function certificateBlocker(s: CertificateSubject): string | null {
  if (s.status === 'running' || s.status === 'queued') {
    return 'The audit or a re-test is still running. Wait until it has finished.';
  }
  if (s.status !== 'completed') {
    return 'The audit did not complete, so there is nothing to show. Start a new audit.';
  }
  if (count(s.findings, 'LEAKED') > 0) {
    return 'A leak was found and is still there. Fix it, then run a re-test.';
  }
  if (count(s.findings, 'BLOCKED') === 0) {
    return 'No table was shown to be blocked, so no result can be issued.';
  }
  if (s.cleanup === 'failed') {
    return 'The temporary test users could not be removed. Clean them up by hand, then run a re-test.';
  }
  return null;
}

/** JSON with every object's keys sorted, so the same record gives the same text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * sha256 of the audit record: target label and URL, findings, summary and run
 * times. Never a key. An integrity fingerprint, not a signature.
 */
export function recordHash(s: CertificateSubject): string {
  const lr = s.lastRetest;
  const record = {
    auditId: s.id,
    label: s.label,
    projectUrl: s.projectUrl,
    createdAt: s.createdAt,
    issuedAt: s.completedAt,
    lastRetest: lr
      ? {
          status: lr.status,
          startedAt: lr.startedAt,
          finishedAt: lr.finishedAt,
          tablesAdded: lr.tablesAdded,
          tablesRemoved: lr.tablesRemoved,
        }
      : null,
    summary: {
      blocked: count(s.findings, 'BLOCKED'),
      inconclusive: count(s.findings, 'INCONCLUSIVE'),
      leaked: count(s.findings, 'LEAKED'),
    },
    findings: s.findings,
  };
  return createHash('sha256').update(canonicalJson(record)).digest('hex');
}

export function buildCertificate(s: CertificateSubject) {
  return {
    auditId: s.id,
    issuedAt: s.completedAt,
    result: CERTIFICATE_RESULT,
    checksRun: ['data-access-prover'],
    summary: {
      blocked: count(s.findings, 'BLOCKED'),
      inconclusive: count(s.findings, 'INCONCLUSIVE'),
    },
    disclaimer: CERTIFICATE_DISCLAIMER,
    recordHash: recordHash(s),
  };
}
