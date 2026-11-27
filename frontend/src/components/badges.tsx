'use client';

import { useEffect } from 'react';
import { BADGE_IDS, shouldAnimate, type BadgeId, type BadgeState } from '@/lib/badges';
import { COVERAGE, COVERAGE_UR } from '@/lib/coverage';
import { formatDate, unverifiedText } from '@/lib/format';
import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

// The ids stay as they are (they are what is stored). These are the names the
// user sees (R64). Wording (R38, R39): never "secure", "safe" or "certified".
// "Zero leaks reached" always comes with the sentence of what the checks cover.
// Every earned badge shows "Earned <date>".
const BADGES: Record<BadgeId, { name: string; locked: string }> = {
  first_audit: {
    name: 'First audit completed',
    locked: 'Finish your first audit.',
  },
  first_fix: {
    name: 'First leak fixed (verified by Re-test)',
    locked: 'Fix a leak, then run a Re-test that shows the table BLOCKED.',
  },
  no_leak_found: {
    name: 'Zero leaks reached',
    locked:
      'An audit with no leak and at least one table BLOCKED (re-test result available).',
  },
};

/**
 * The badges that run their animation: it plays once, then `onCelebrated`
 * stores that it was shown. With "reduce motion" there is no animation, so it
 * counts as shown at once. A timer covers a tab where the animation never
 * ends (a hidden tab).
 */
function useCelebrations(
  state: BadgeState,
  celebrating: readonly BadgeId[],
  onCelebrated: (id: BadgeId) => void,
) {
  useEffect(() => {
    const pending = celebrating.filter((id) => shouldAnimate(state, id, true));
    if (pending.length === 0) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(
      () => pending.forEach(onCelebrated),
      reduce ? 0 : 1_500,
    );
    return () => window.clearTimeout(timer);
  }, [celebrating, onCelebrated, state]);
}

function Badge({
  id,
  state,
  animate,
  onCelebrated,
  inconclusiveCount,
}: {
  id: BadgeId;
  state: BadgeState;
  animate: boolean;
  onCelebrated: (id: BadgeId) => void;
  inconclusiveCount: number;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  const record = state[id];
  const copy = BADGES[id];
  return (
    <li
      className="badge"
      data-earned={record ? 'true' : 'false'}
      data-celebrate={animate ? 'true' : 'false'}
      onAnimationEnd={() => onCelebrated(id)}
    >
      <span className="badge-dot" aria-hidden="true" />
      <strong className="badge-name">{w(copy.name)}</strong>
      <span className="badge-detail">
        {record
          ? `${uiLang === 'ur' ? 'Mila' : 'Earned'} ${formatDate(record.at)}`
          : w(copy.locked)}
      </span>
      {record && id === 'no_leak_found' && inconclusiveCount > 0 ? (
        <span className="badge-detail">{unverifiedText(inconclusiveCount)}</span>
      ) : null}
    </li>
  );
}

/** All three badges, on the Report screen. */
export function BadgeStrip({
  state,
  celebrating,
  onCelebrated,
  inconclusiveCount,
}: {
  state: BadgeState;
  celebrating: readonly BadgeId[];
  onCelebrated: (id: BadgeId) => void;
  /** tables the checks could not decide: said next to "Zero leaks reached" */
  inconclusiveCount: number;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  useCelebrations(state, celebrating, onCelebrated);
  const earnedNow = BADGE_IDS.filter((id) =>
    shouldAnimate(state, id, celebrating.includes(id)),
  );

  return (
    <section className="card badges-card glass" aria-labelledby="badges-heading">
      <h2 id="badges-heading">{w('Badges')}</h2>
      <p className="muted small">
        {w('Saved in this browser only. They are not proof and are not part of the re-test result or its record hash.')}
      </p>
      <p className="visually-hidden" role="status">
        {earnedNow.length > 0
          ? `${uiLang === 'ur' ? 'Badge mila' : 'Badge earned'}: ${earnedNow.map((id) => w(BADGES[id].name)).join(', ')}`
          : ''}
      </p>
      <ul className="badge-list">
        {BADGE_IDS.map((id) => (
          <Badge
            key={id}
            id={id}
            state={state}
            animate={shouldAnimate(state, id, celebrating.includes(id))}
            onCelebrated={onCelebrated}
            inconclusiveCount={inconclusiveCount}
          />
        ))}
      </ul>
      <p className="muted small">{uiLang === 'ur' ? COVERAGE_UR.statement : COVERAGE.statement}</p>
    </section>
  );
}

/** Only the badges the user just earned, on the Progress screen. */
export function BadgeNotice({
  state,
  justEarned,
  celebrating,
  onCelebrated,
  inconclusiveCount,
}: {
  state: BadgeState;
  justEarned: readonly BadgeId[];
  celebrating: readonly BadgeId[];
  onCelebrated: (id: BadgeId) => void;
  inconclusiveCount: number;
}) {
  const [uiLang] = useLang();
  const w = (text: string) => uiText(text, uiLang);
  useCelebrations(state, celebrating, onCelebrated);
  if (justEarned.length === 0) return null;
  return (
    <div className="badge-notice">
      <p role="status">
        {uiLang === 'ur' ? 'Badge mila' : 'Badge earned'}:{' '}
        {justEarned.map((id) => w(BADGES[id].name)).join(', ')}
      </p>
      <ul className="badge-list">
        {justEarned.map((id) => (
          <Badge
            key={id}
            id={id}
            state={state}
            animate={shouldAnimate(state, id, celebrating.includes(id))}
            onCelebrated={onCelebrated}
            inconclusiveCount={inconclusiveCount}
          />
        ))}
      </ul>
      <p className="muted small">{uiLang === 'ur' ? COVERAGE_UR.statement : COVERAGE.statement}</p>
    </div>
  );
}
