'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Verdict } from '@/lib/types';
import { VerdictIcon } from './verdict';

type Phase = 'idle' | 'owner' | 'leaked' | 'fixing' | 'blocked';

const PHASE_COPY: Record<
  Phase,
  { pill: string; summary: string; verdict: Verdict | null; active: boolean }
> = {
  idle: {
    pill: 'Checks running',
    summary: 'Owner A can use the row. User B and Anon are trying to reach it.',
    verdict: null,
    active: true,
  },
  owner: {
    pill: 'Owner check passed',
    summary: 'Owner A reached the canary row in the control check.',
    verdict: null,
    active: true,
  },
  leaked: {
    pill: 'LEAKED',
    summary: '4 of 4 attacker checks reached the canary row.',
    verdict: 'LEAKED',
    active: false,
  },
  fixing: {
    pill: 'Fix applied, re-testing',
    summary: 'A policy now sits in the middle. The same attempts are running again.',
    verdict: null,
    active: true,
  },
  blocked: {
    pill: 'BLOCKED',
    summary: 'No leak found by these checks.',
    verdict: 'BLOCKED',
    active: false,
  },
};

const ATTACK_OPERATIONS = {
  user_b: ['SELECT', 'UPDATE', 'DELETE'],
  anon: ['SELECT'],
} as const;

function statusChipState(
  actor: 'owner' | 'user_b' | 'anon',
  phase: Phase,
): 'idle' | 'allowed' | 'reached' | 'blocked' {
  if (actor === 'owner') return phase === 'idle' ? 'idle' : 'allowed';
  if (phase === 'leaked') return 'reached';
  if (phase === 'blocked') return 'blocked';
  return 'idle';
}

function ChipIcon({ state }: { state: 'idle' | 'allowed' | 'reached' | 'blocked' }) {
  if (state === 'allowed' || state === 'blocked') {
    return (
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path
          d="m3.4 8.2 3 3L12.6 4.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (state === 'reached') {
    return (
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 5v3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M8 10.8h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  return <span className="chip-idle-dot" aria-hidden="true" />;
}

function PillMark({ active, verdict }: { active: boolean; verdict: Verdict | null }) {
  if (verdict) return <VerdictIcon verdict={verdict} size={14} />;
  return (
    <span
      className={`pill-live-mark ${active ? 'is-live' : ''}`}
      aria-hidden="true"
    />
  );
}

export function HeroMotion() {
  const [phase, setPhase] = useState<Phase>('blocked');
  const [ready, setReady] = useState(false);
  const [isFinal, setIsFinal] = useState(true);
  const [runId, setRunId] = useState(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const nudgeAccessCode = useCallback(() => {
    const input = document.getElementById('access-code');
    if (!(input instanceof HTMLInputElement)) return;
    input.classList.remove('field-nudge');
    void input.offsetWidth;
    input.classList.add('field-nudge');
    timers.current.push(
      window.setTimeout(() => input.classList.remove('field-nudge'), 1_700),
    );
  }, []);

  const startStory = useCallback(() => {
    clearTimers();

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      setIsFinal(true);
      setPhase('blocked');
      setReady(true);
      return;
    }

    setIsFinal(false);
    setPhase('idle');
    setReady(true);

    timers.current = [
      window.setTimeout(() => setPhase('owner'), 2_300),
      window.setTimeout(() => setPhase('leaked'), 3_700),
      window.setTimeout(() => setPhase('fixing'), 4_900),
      window.setTimeout(() => setPhase('blocked'), 6_600),
      window.setTimeout(nudgeAccessCode, 7_400),
    ];
  }, [clearTimers, nudgeAccessCode]);

  useEffect(() => {
    startStory();
    return clearTimers;
  }, [runId, startStory, clearTimers]);

  const replay = useCallback(() => {
    setReady(false);
    setRunId((id) => id + 1);
  }, []);

  useEffect(() => {
    window.addEventListener('vca:replay-hero', replay);
    return () => window.removeEventListener('vca:replay-hero', replay);
  }, [replay]);

  function skip() {
    clearTimers();
    setIsFinal(true);
    setPhase('blocked');
  }

  const copy = PHASE_COPY[phase];
  const finalFrame = isFinal || phase === 'blocked';

  return (
    <section className="motion-panel" aria-label="Example run">
      <div className="motion-head">
        <div className="motion-title">
          <span className="motion-table">bookings</span>
          <span className="motion-tag">Example run</span>
        </div>
        <span
          className={`motion-pill ${copy.verdict ? `motion-pill-${copy.verdict.toLowerCase()}` : 'motion-pill-live'}`}
          role="status"
          aria-live="polite"
        >
          <PillMark active={copy.active} verdict={copy.verdict} />
          <span key={`${phase}-pill`} className="motion-pill-text">
            {copy.pill}
          </span>
        </span>
      </div>

      <div
        className={`motion-stage ${isFinal ? 'is-final' : ''}`}
        data-phase={phase}
        data-ready={ready ? 'true' : 'false'}
        data-final={finalFrame ? 'true' : 'false'}
        key={runId}
      >
        <div className="motion-glow motion-glow-canary" aria-hidden="true" />
        <div className="motion-glow motion-glow-leak" aria-hidden="true" />

        <svg
          className="motion-svg"
          viewBox="0 0 720 380"
          role="img"
          aria-label="Animated test: Owner A, User B and Anon try to reach one canary row in the bookings table"
        >
          <defs>
            <filter
              id="motion-blur"
              filterUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="720"
              height="380"
            >
              <feGaussianBlur stdDeviation="5" />
            </filter>
            <clipPath id="attack-clip-open">
              <rect x="0" y="0" width="720" height="380" />
            </clipPath>
            <clipPath id="attack-clip-gate">
              <rect x="0" y="0" width="468" height="380" />
            </clipPath>
          </defs>

          <path className="motion-path-base" d="M82 60 C 260 60, 340 190, 514 190" />
          <path className="motion-path-base" d="M82 190 C 260 190, 340 190, 514 190" />
          <path className="motion-path-base" d="M82 320 C 260 320, 340 190, 514 190" />

          <g className="motion-rows" aria-hidden="true">
            <rect className="motion-row" x="516" y="36" width="170" height="32" rx="8" />
            <rect className="motion-row-line" x="530" y="49" width="90" height="6" rx="3" />
            <rect className="motion-row" x="516" y="82" width="170" height="32" rx="8" />
            <rect className="motion-row-line" x="530" y="95" width="120" height="6" rx="3" />
            <rect className="motion-row" x="516" y="128" width="170" height="32" rx="8" />
            <rect className="motion-row-line" x="530" y="141" width="70" height="6" rx="3" />
            <rect className="motion-row" x="516" y="220" width="170" height="32" rx="8" />
            <rect className="motion-row-line" x="530" y="233" width="105" height="6" rx="3" />
            <rect className="motion-row" x="516" y="266" width="170" height="32" rx="8" />
            <rect className="motion-row-line" x="530" y="279" width="80" height="6" rx="3" />
          </g>

          <rect className="motion-canary-row" x="516" y="174" width="170" height="32" rx="8" />
          <circle className="motion-canary-dot" cx="534" cy="190" r="6" />
          <text className="motion-canary-label" x="548" y="194">
            canary
          </text>

          <g className="motion-gate" aria-hidden="true">
            <line x1="470" y1="26" x2="470" y2="360" />
            <text x="470" y="16">
              policy
            </text>
          </g>

          <g aria-hidden="true">
            <circle className="motion-actor" cx="60" cy="60" r="20" />
            <text className="motion-actor-init" x="60" y="65">
              A
            </text>
            <text className="motion-actor-name" x="60" y="24">
              Owner A
            </text>

            <circle className="motion-actor" cx="60" cy="190" r="20" />
            <text className="motion-actor-init" x="60" y="195">
              B
            </text>
            <text className="motion-actor-name" x="60" y="154">
              User B
            </text>

            <circle className="motion-actor" cx="60" cy="320" r="20" />
            <text className="motion-actor-init" x="60" y="325">
              ?
            </text>
            <text className="motion-actor-name" x="60" y="284">
              Anon
            </text>
          </g>

          <g aria-hidden="true">
            <path
              className="motion-streak motion-streak-glow motion-owner"
              pathLength={1}
              d="M82 60 C 260 60, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-owner"
              pathLength={1}
              d="M82 60 C 260 60, 340 190, 514 190"
            />
          </g>

          <g clipPath="url(#attack-clip-open)" aria-hidden="true">
            <path
              className="motion-streak motion-streak-glow motion-attack-leak"
              pathLength={1}
              d="M82 190 C 260 190, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-leak"
              pathLength={1}
              d="M82 190 C 260 190, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-glow motion-attack-leak"
              pathLength={1}
              d="M82 320 C 260 320, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-leak"
              pathLength={1}
              d="M82 320 C 260 320, 340 190, 514 190"
            />

            <path
              className="motion-streak motion-streak-glow motion-attack-blocked"
              pathLength={1}
              d="M82 190 C 260 190, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-leak"
              pathLength={1}
              d="M82 320 C 260 320, 340 190, 514 190"
            />
          </g>

          <g clipPath="url(#attack-clip-gate)" aria-hidden="true">
            <path
              className="motion-streak motion-streak-glow motion-attack-blocked"
              pathLength={1}
              d="M82 320 C 260 320, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-blocked"
              pathLength={1}
              d="M82 320 C 260 320, 340 190, 514 190"
            />
          </g>

          <g className="motion-scatter" aria-hidden="true">
            {[
              { cx: 470, cy: 174, dx: -18, dy: -16 },
              { cx: 470, cy: 182, dx: 9, dy: -22 },
              { cx: 470, cy: 198, dx: 20, dy: -10 },
              { cx: 470, cy: 206, dx: 12, dy: 18 },
              { cx: 470, cy: 190, dx: -8, dy: 24 },
              { cx: 470, cy: 186, dx: -24, dy: 4 },
            ].map((dot, index) => (
              <circle
                key={index}
                className="motion-scatter-dot"
                cx={dot.cx}
                cy={dot.cy}
                r="3"
                style={
                  {
                    '--scatter-x': `${dot.dx}px`,
                    '--scatter-y': `${dot.dy}px`,
                  } as CSSProperties
                }
              />
            ))}
          </g>

          <circle className="motion-ring motion-ring-canary" cx="534" cy="190" r="14" />
          <circle className="motion-ring motion-ring-gate" cx="470" cy="190" r="14" />
        </svg>
      </div>

      <div className="motion-lanes">
        <div className="motion-lane">
          <span className="motion-lane-name">Owner A</span>
          <div className="motion-chips">
            {['SELECT', 'INSERT'].map((operation) => {
              const state = statusChipState('owner', phase);
              return (
                <span className={`motion-chip motion-chip-${state}`} key={operation}>
                  <ChipIcon state={state} />
                  <b>{operation}</b>
                  <span>{state}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="motion-lane">
          <span className="motion-lane-name">User B</span>
          <div className="motion-chips">
            {ATTACK_OPERATIONS.user_b.map((operation) => {
              const state = statusChipState('user_b', phase);
              return (
                <span className={`motion-chip motion-chip-${state}`} key={operation}>
                  <ChipIcon state={state} />
                  <b>{operation}</b>
                  <span>{state}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="motion-lane">
          <span className="motion-lane-name">Anon</span>
          <div className="motion-chips">
            {ATTACK_OPERATIONS.anon.map((operation) => {
              const state = statusChipState('anon', phase);
              return (
                <span className={`motion-chip motion-chip-${state}`} key={operation}>
                  <ChipIcon state={state} />
                  <b>{operation}</b>
                  <span>{state}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <p key={`${phase}-summary`} className="motion-summary">
        {copy.summary}
      </p>

      <div className="motion-controls">
        <span className="motion-controls-label">Example run</span>
        <button
          type="button"
          className="button button-small"
          onClick={skip}
          disabled={finalFrame}
        >
          Skip animation
        </button>
        <button type="button" className="button button-small" onClick={replay}>
          Replay
        </button>
      </div>
    </section>
  );
}
