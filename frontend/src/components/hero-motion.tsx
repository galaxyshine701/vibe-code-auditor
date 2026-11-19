'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  chipState as statusChipState,
  CARD_STORY_MS,
  INTRO_SCALE,
  phaseAt,
  type Actor,
  type ChipState,
  type Phase,
} from '@/lib/intro';
import type { Verdict } from '@/lib/types';
import { VerdictIcon } from './verdict';

const PHASE_COPY: Record<
  Phase,
  { pill: string; summary: string; verdict: Verdict | null; active: boolean }
> = {
  idle: {
    pill: 'Checks running',
    summary:
      'Owner A can use the row. User B and the Visitor are trying to reach it.',
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
    summary: 'User B and the Visitor both reached the canary row.',
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
  visitor: ['SELECT'],
} as const;

function ChipIcon({ state }: { state: ChipState }) {
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

/**
 * The example run (a canary row, a policy, three actors). It is used twice:
 * as the intro of the home page (mode "intro", one run, then `onFinish`), and in
 * the hero as the last frame (mode "static", no timers).
 */
export function HeroMotion({
  mode,
  onFinish,
}: {
  mode: 'intro' | 'static';
  onFinish?: () => void;
}) {
  const intro = mode === 'intro';
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [phase, setPhase] = useState<Phase>(intro ? 'idle' : 'blocked');
  const [ready, setReady] = useState(!intro);
  const [runId, setRunId] = useState(0);
  const timers = useRef<number[]>([]);
  const finish = useRef(onFinish);

  useEffect(() => {
    finish.current = onFinish;
  }, [onFinish]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!intro) return;
    // The stage is built again so that its CSS animations start together with
    // these timers, not at the first paint of the server's HTML.
    setRunId((id) => id + 1);
    setPhase('idle');
    setReady(true);
    timers.current = [
      window.setTimeout(() => setPhase('owner'), phaseAt('owner')),
      window.setTimeout(() => setPhase('leaked'), phaseAt('leaked')),
      window.setTimeout(() => setPhase('fixing'), phaseAt('fixing')),
      window.setTimeout(() => setPhase('blocked'), phaseAt('blocked')),
      window.setTimeout(() => finish.current?.(), CARD_STORY_MS + 500),
    ];
    return clearTimers;
  }, [intro, clearTimers]);

  const copy = PHASE_COPY[phase];
  const finalFrame = !intro || phase === 'blocked';
  const stageStyle = { '--hs': intro ? INTRO_SCALE : 1 } as CSSProperties;

  /** The Visitor's verdict follows User B's, as its streak does. */
  function chipDelay(actor: Actor): CSSProperties | undefined {
    if (!intro || actor !== 'visitor') return undefined;
    if (phase === 'leaked') {
      return { transitionDelay: `${Math.round(800 * INTRO_SCALE)}ms` };
    }
    if (phase === 'blocked') {
      return { transitionDelay: `${Math.round(200 * INTRO_SCALE)}ms` };
    }
    return undefined;
  }

  const blurId = `motion-blur-${uid}`;
  const openClip = `attack-clip-open-${uid}`;
  const gateClip = `attack-clip-gate-${uid}`;

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
        className={`motion-stage ${intro ? '' : 'is-final'}`}
        data-phase={phase}
        data-ready={ready ? 'true' : 'false'}
        data-final={finalFrame ? 'true' : 'false'}
        style={stageStyle}
        key={runId}
      >
        <div className="motion-glow motion-glow-canary" aria-hidden="true" />
        <div className="motion-glow motion-glow-leak" aria-hidden="true" />

        <svg
          className="motion-svg"
          viewBox="0 0 720 380"
          role="img"
          aria-label="Example run: Owner A, User B and a Visitor try to reach one canary row in the bookings table"
        >
          <defs>
            <filter
              id={blurId}
              filterUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="720"
              height="380"
            >
              <feGaussianBlur stdDeviation="5" />
            </filter>
            <clipPath id={openClip}>
              <rect x="0" y="0" width="720" height="380" />
            </clipPath>
            <clipPath id={gateClip}>
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

          {/* the lock of the canary row: open until the policy is added, closed after */}
          <g className="motion-lock" aria-hidden="true">
            <rect className="motion-lock-body" x="656" y="188" width="16" height="11" rx="2.5" />
            <path
              className="motion-lock-shackle"
              d="M659 188 V185 a5 5 0 0 1 10 0 V188"
              fill="none"
            />
          </g>

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
              Visitor
            </text>
          </g>

          <g aria-hidden="true">
            <path
              className="motion-streak motion-streak-glow motion-owner"
              pathLength={1}
              filter={`url(#${blurId})`}
              d="M82 60 C 260 60, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-owner"
              pathLength={1}
              d="M82 60 C 260 60, 340 190, 514 190"
            />
          </g>

          {/* before the policy: User B reaches the row first, then the Visitor */}
          <g clipPath={`url(#${openClip})`} aria-hidden="true">
            <path
              className="motion-streak motion-streak-glow motion-attack-leak motion-leak-b"
              pathLength={1}
              filter={`url(#${blurId})`}
              d="M82 190 C 260 190, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-leak motion-leak-b"
              pathLength={1}
              d="M82 190 C 260 190, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-glow motion-attack-leak motion-leak-v"
              pathLength={1}
              filter={`url(#${blurId})`}
              d="M82 320 C 260 320, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-leak motion-leak-v"
              pathLength={1}
              d="M82 320 C 260 320, 340 190, 514 190"
            />
          </g>

          {/* after the policy: both stop at it, User B first */}
          <g clipPath={`url(#${gateClip})`} aria-hidden="true">
            <path
              className="motion-streak motion-streak-glow motion-attack-blocked motion-block-b"
              pathLength={1}
              filter={`url(#${blurId})`}
              d="M82 190 C 260 190, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-blocked motion-block-b"
              pathLength={1}
              d="M82 190 C 260 190, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-glow motion-attack-blocked motion-block-v"
              pathLength={1}
              filter={`url(#${blurId})`}
              d="M82 320 C 260 320, 340 190, 514 190"
            />
            <path
              className="motion-streak motion-streak-core motion-attack-blocked motion-block-v"
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
                <span
                  className={`motion-chip motion-chip-${state}`}
                  key={operation}
                  style={chipDelay('user_b')}
                >
                  <ChipIcon state={state} />
                  <b>{operation}</b>
                  <span>{state}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="motion-lane">
          <span className="motion-lane-name">Visitor</span>
          <div className="motion-chips">
            {ATTACK_OPERATIONS.visitor.map((operation) => {
              const state = statusChipState('visitor', phase);
              return (
                <span
                  className={`motion-chip motion-chip-${state}`}
                  key={operation}
                  style={chipDelay('visitor')}
                >
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

      {!intro ? (
        <div className="motion-controls">
          <span className="motion-controls-label">Last frame of the intro</span>
          <button
            type="button"
            className="button button-small motion-replay"
            onClick={() => window.dispatchEvent(new Event('vca:replay-hero'))}
          >
            Replay intro
          </button>
        </div>
      ) : null}
    </section>
  );
}
