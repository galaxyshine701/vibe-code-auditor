import type { CSSProperties } from 'react';

// The checkpoint lane of the example run (docs/design/gatecheck-scene.html does
// not exist, so this is a plain version of the idea): a straight rail runs down
// the left of the rows, with one checkpoint on it for each row, and a bar at the
// gate. A small dot travels down the rail with the scan beam. What a checkpoint
// looks like says what the check found, and the word of the verdict is always
// written in the row next to it, so a shape and a colour are never the only
// message:
//
//   a bar across the lane      BLOCKED       it was stopped
//   an open ring               LEAKED        it got through
//   a dashed ring              INCONCLUSIVE  not proven either way
//
// Only SVG and CSS (hero.css): no library, no lock, no tick. With reduced
// motion, and on a phone, the dot is not shown and the checkpoints are in their
// final colour.
export type LaneTone = 'ok' | 'leak' | 'warn';

export const LANE_SHAPE: Record<LaneTone, 'bar' | 'open' | 'dashed'> = {
  ok: 'bar',
  leak: 'open',
  warn: 'dashed',
};

export function LaneNode({ tone }: { tone: LaneTone }) {
  const shape = LANE_SHAPE[tone];
  return (
    <svg
      className={`hero-node hero-node-${shape}`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      {shape === 'bar' ? <path d="M4 12H20" /> : null}
      {shape === 'open' ? <path d="M7.2 17.6A7.6 7.6 0 1 1 16.8 17.6" /> : null}
      {shape === 'dashed' ? <circle cx="12" cy="12" r="7.4" /> : null}
    </svg>
  );
}

/** The bar at the gate: one wide line across the end of the lane. */
export function GateBar() {
  return (
    <svg
      className="hero-node hero-node-gate"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 12H21" />
    </svg>
  );
}

/** The dot that travels down the rail with the beam (hidden with reduced motion and on a phone). */
export function LaneDot({ delay, duration }: { delay: string; duration: string }) {
  return (
    <span
      className="hero-lane-dot"
      aria-hidden="true"
      style={{ '--dot-delay': delay, '--dot-dur': duration } as CSSProperties}
    />
  );
}
