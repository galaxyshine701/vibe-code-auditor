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
        {/* a round mark with one bar across it: stopped. A plain shape, with no
            tick and no lock (the same bar as the checkpoint lane) */}
        <circle cx="8" cy="8" r="6" />
        <path d="M4.9 8h6.2" />
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
