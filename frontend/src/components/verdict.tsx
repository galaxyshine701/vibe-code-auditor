import type { Verdict } from '@/lib/types';

export function VerdictIcon({
  verdict,
  size = 15,
}: {
  verdict: Verdict;
  size?: number;
}) {
  if (verdict === 'LEAKED') {
    return (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M8 2.2 14.1 13H1.9L8 2.2Z" strokeLinejoin="round" />
        <path d="M8 6.1v3.1" />
        <path d="M8 11.4h.01" />
      </svg>
    );
  }

  if (verdict === 'BLOCKED') {
    return (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 1.8 13.4 4v3.5c0 3.1-2.1 5.4-5.4 6.7-3.3-1.3-5.4-3.6-5.4-6.7V4L8 1.8Z" />
        <path d="m5.3 8 1.8 1.8L10.8 6" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M6.2 6.1a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.2v.4" />
      <path d="M8 11.9h.01" />
    </svg>
  );
}

export function VerdictBadge({
  verdict,
  label,
  className = '',
}: {
  verdict: Verdict;
  label?: string;
  className?: string;
}) {
  return (
    <span className={`verdict-badge verdict-${verdict.toLowerCase()} ${className}`.trim()}>
      <VerdictIcon verdict={verdict} />
      <span>{label ?? verdict}</span>
    </span>
  );
}
