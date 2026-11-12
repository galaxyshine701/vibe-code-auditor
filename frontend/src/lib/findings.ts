import type { Finding, Severity, Verdict } from './types';

const VERDICT_ORDER: Record<Verdict, number> = {
  LEAKED: 0,
  INCONCLUSIVE: 1,
  BLOCKED: 2,
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const verdict = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    if (verdict !== 0) return verdict;

    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;

    return a.table.localeCompare(b.table);
  });
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === 'LEAKED') return 'Leaked';
  if (verdict === 'BLOCKED') return 'Blocked';
  return 'Inconclusive';
}

export function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
