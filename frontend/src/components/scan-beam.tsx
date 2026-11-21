import type { CSSProperties } from 'react';

// A scan beam: a thin glowing band that sweeps over what is drawn under it, from
// one side to the other. It is an SVG piece with no state and no timers, made
// of two rects and one gradient, and moved by CSS (intro.css, `.scan-beam`). The
// intro uses it now; the example card of the hero can use it later: put it in
// any <svg>, give it the start and the end of its way and its own times.
//
//   axis      the way it travels: "x" (left to right) or "y" (top to bottom)
//   from, to  the start and the end of the way, in the units of the SVG
//   span      how far the band reaches across the way: [start, end]
//   delay     when it starts (a CSS time, "0.8s"); duration: how long it sweeps
//   thickness the width of the glow, in SVG units
//
// Colours are the theme's (--canary and its glow). With reduced motion it is
// not drawn at all (intro.css).
export interface ScanBeamProps {
  axis: 'x' | 'y';
  from: number;
  to: number;
  span: [number, number];
  delay: string;
  duration: string;
  id: string;
  thickness?: number;
}

export function ScanBeam({
  axis,
  from,
  to,
  span,
  delay,
  duration,
  id,
  thickness = 26,
}: ScanBeamProps) {
  const isX = axis === 'x';
  const [start, end] = span;
  const length = end - start;
  const gradient = `${id}-gradient`;
  const style = {
    '--beam-from': `${from}px`,
    '--beam-to': `${to}px`,
    '--beam-delay': delay,
    '--beam-dur': duration,
  } as CSSProperties;

  // the band is drawn around 0 on the way, and moved by the animation
  const band = isX
    ? { x: -thickness / 2, y: start, width: thickness, height: length }
    : { x: start, y: -thickness / 2, width: length, height: thickness };
  const core = isX
    ? { x: -0.75, y: start, width: 1.5, height: length }
    : { x: start, y: -0.75, width: length, height: 1.5 };

  return (
    <g className="scan-beam" data-axis={axis} style={style} aria-hidden="true">
      <defs>
        <linearGradient
          id={gradient}
          x1="0"
          y1="0"
          x2={isX ? '1' : '0'}
          y2={isX ? '0' : '1'}
        >
          <stop offset="0" style={{ stopColor: 'var(--canary)', stopOpacity: 0 }} />
          <stop offset="0.5" style={{ stopColor: 'var(--canary)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--canary)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <rect className="scan-beam-glow" {...band} fill={`url(#${gradient})`} />
      <rect className="scan-beam-core" {...core} />
    </g>
  );
}
