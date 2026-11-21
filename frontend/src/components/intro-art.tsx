import type { CSSProperties } from 'react';
import { INTRO_SCENE_MS } from '@/lib/intro';
import { ScanBeam } from './scan-beam';

// The picture of the intro (R70), drawn in SVG and moved by CSS (intro.css).
//
//   0 to 0.8 s   a faint grid; a website (a browser frame) and a database (a
//                stack of table rows) draw on, line by line; thin rings turn
//   0.8 to 2.3 s a beam sweeps over them; as it passes, a callout and a small
//                label appear for each thing it looks at (Site headers,
//                Scripts, Tables) and a counter goes 0/3, 1/3, 2/3, 3/3. A few
//                lines of text that are masked (dots), never a real key
//   2.3 s        the objects leave and the rings contract into a thin line
//
// Two layouts, because a phone is tall: "wide" (website left, database right,
// the beam goes left to right) and "tall" (website above, database below, the
// beam goes top to bottom). intro.css shows one of them (480 px and narrower:
// the tall one). Nothing here is a number the user must read: the picture is
// decoration, so it is hidden from assistive technology.
type Point = [number, number];

interface Layout {
  name: 'wide' | 'tall';
  viewBox: [number, number];
  centre: Point;
  /** the top left corner of the website frame (180 x 140) */
  web: Point;
  /** the top left corner of the first table row (180 x 40, rows 54 apart) */
  db: Point;
  axis: 'x' | 'y';
  beam: { from: number; to: number; span: [number, number] };
  counter: Point;
  rings: number[];
  /** masked lines of text: where, what, and where on the way of the beam they are */
  fragments: { at: Point; text: string }[];
}

const LAYOUTS: Record<'wide' | 'tall', Layout> = {
  wide: {
    name: 'wide',
    viewBox: [640, 360],
    centre: [320, 180],
    web: [62, 106],
    db: [398, 112],
    axis: 'x',
    beam: { from: 24, to: 616, span: [28, 332] },
    counter: [320, 34],
    rings: [66, 108, 150],
    fragments: [
      { at: [262, 142], text: 'Content-Sec••••••' },
      { at: [262, 204], text: 'apikey: ••••••••' },
      { at: [404, 290], text: 'select •••• from ••••' },
      { at: [404, 304], text: 'where owner = ••••' },
    ],
  },
  tall: {
    name: 'tall',
    viewBox: [320, 600],
    centre: [160, 300],
    web: [70, 92],
    db: [70, 372],
    axis: 'y',
    beam: { from: 40, to: 560, span: [16, 304] },
    counter: [160, 584],
    rings: [60, 92, 126],
    fragments: [
      { at: [256, 150], text: 'key ••••' },
      { at: [256, 186], text: 'id ••••' },
      { at: [256, 400], text: 'uid •••' },
      { at: [256, 430], text: 'owner ••' },
    ],
  },
};

const BEAM_START = INTRO_SCENE_MS.beam / 1000;
const BEAM_DUR = (INTRO_SCENE_MS.contract - INTRO_SCENE_MS.beam) / 1000;

/** The moment the beam is at `along` (a position on its way), in seconds. */
function passAt(layout: Layout, along: number): number {
  const { from, to } = layout.beam;
  return BEAM_START + (BEAM_DUR * (along - from)) / (to - from);
}

const dash = (seconds: number): CSSProperties =>
  ({ '--d': `${seconds.toFixed(2)}s` }) as CSSProperties;

export function IntroArt({ layout: name }: { layout: 'wide' | 'tall' }) {
  const L = LAYOUTS[name];
  const [cx, cy] = L.centre;
  const [wx, wy] = L.web;
  const [dx, dy] = L.db;
  const along = (point: Point) => (L.axis === 'x' ? point[0] : point[1]);

  // what the beam looks at: a point of the thing, a connector out of it, a label
  const callouts = [
    {
      id: 'headers',
      en: 'Site headers',
      ur: 'Site ke headers',
      from: [wx + 34, wy + 13] as Point,
      to: [wx + 34, wy - 20] as Point,
    },
    {
      id: 'scripts',
      en: 'Scripts',
      ur: 'Site ki scripts',
      from: [wx + 108, wy + 140] as Point,
      to: [wx + 108, wy + 174] as Point,
    },
    {
      id: 'tables',
      en: 'Tables',
      ur: 'Tables ka data',
      from: [dx + 90, dy] as Point,
      to: [dx + 90, dy - 30] as Point,
    },
  ].map((c) => ({ ...c, at: passAt(L, along(c.from)) }));

  return (
    <svg
      className={`intro-art intro-art-${L.name}`}
      viewBox={`0 0 ${L.viewBox[0]} ${L.viewBox[1]}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id={`intro-grid-${L.name}`}
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <path d="M32 0H0V32" className="intro-grid-line" />
        </pattern>
      </defs>

      <rect
        className="intro-grid"
        x="0"
        y="0"
        width={L.viewBox[0]}
        height={L.viewBox[1]}
        fill={`url(#intro-grid-${L.name})`}
      />

      {/* thin rings, behind everything, turning slowly; they end as the gate line */}
      <g className="intro-rings">
        {L.rings.map((r, i) => (
          <circle
            key={r}
            className={`intro-ring intro-ring-${i % 2 ? 'back' : 'fore'}`}
            cx={cx}
            cy={cy}
            r={r}
          />
        ))}
      </g>

      <g className="intro-objects">
        {/* the website: a browser frame */}
        <g transform={`translate(${wx} ${wy})`} className="intro-object">
          <path
            className="intro-draw"
            style={dash(0.1)}
            pathLength={1}
            d="M10 0H170a10 10 0 0 1 10 10V130a10 10 0 0 1-10 10H10A10 10 0 0 1 0 130V10A10 10 0 0 1 10 0Z"
          />
          <path className="intro-draw" style={dash(0.25)} pathLength={1} d="M0 26H180" />
          <circle className="intro-dot-mark" style={dash(0.4)} cx="14" cy="13" r="2.5" />
          <circle className="intro-dot-mark" style={dash(0.45)} cx="26" cy="13" r="2.5" />
          <circle className="intro-dot-mark" style={dash(0.5)} cx="38" cy="13" r="2.5" />
          <path className="intro-draw" style={dash(0.35)} pathLength={1} d="M58 13H164" />
          <path className="intro-draw" style={dash(0.45)} pathLength={1} d="M18 48H108" />
          <path className="intro-draw" style={dash(0.5)} pathLength={1} d="M18 64H152" />
          <path className="intro-draw" style={dash(0.55)} pathLength={1} d="M18 80H88" />
          <path
            className="intro-draw"
            style={dash(0.6)}
            pathLength={1}
            d="M18 98H66V124H18Z"
          />
          <path className="intro-draw" style={dash(0.65)} pathLength={1} d="M80 98H162V124H80Z" />
        </g>

        {/* the database: a stack of table rows */}
        <g transform={`translate(${dx} ${dy})`} className="intro-object">
          {[0, 54, 108].map((offset, i) => (
            <g key={offset} transform={`translate(0 ${offset})`}>
              <path
                className="intro-draw"
                style={dash(0.2 + i * 0.12)}
                pathLength={1}
                d="M10 0H170a10 10 0 0 1 10 10V30a10 10 0 0 1-10 10H10A10 10 0 0 1 0 30V10A10 10 0 0 1 10 0Z"
              />
              <circle
                className="intro-dot-mark"
                style={dash(0.4 + i * 0.1)}
                cx="18"
                cy="20"
                r="4"
              />
              <path
                className="intro-draw"
                style={dash(0.45 + i * 0.1)}
                pathLength={1}
                d="M34 20H112"
              />
              <path
                className="intro-draw"
                style={dash(0.5 + i * 0.1)}
                pathLength={1}
                d="M126 20H162"
              />
            </g>
          ))}
        </g>
      </g>

      <ScanBeam
        id={`intro-beam-${L.name}`}
        axis={L.axis}
        from={L.beam.from}
        to={L.beam.to}
        span={L.beam.span}
        delay={`${BEAM_START}s`}
        duration={`${BEAM_DUR}s`}
      />

      {/* what the beam looks at: a callout and a small label, in two languages */}
      {callouts.map((c) => (
        <g
          key={c.id}
          className="intro-callout"
          style={{ '--at': `${c.at.toFixed(2)}s` } as CSSProperties}
        >
          <path
            className="intro-callout-line"
            d={`M${c.from[0]} ${c.from[1]}L${c.to[0]} ${c.to[1]}`}
          />
          <circle className="intro-callout-end" cx={c.from[0]} cy={c.from[1]} r="3" />
          <text
            className="intro-label"
            x={c.to[0] - 26}
            y={c.to[1] + (c.to[1] < c.from[1] ? -16 : 18)}
          >
            {c.en}
          </text>
          <text
            className="intro-label intro-label-ur"
            x={c.to[0] - 26}
            y={c.to[1] + (c.to[1] < c.from[1] ? -4 : 30)}
          >
            {c.ur}
          </text>
        </g>
      ))}

      {/* text that is masked: dots, never a real key */}
      {L.fragments.map((f) => (
        <text
          key={f.text}
          className="intro-fragment"
          x={f.at[0]}
          y={f.at[1]}
          style={
            { '--at': `${(passAt(L, along(f.at)) + 0.05).toFixed(2)}s` } as CSSProperties
          }
        >
          {f.text}
        </text>
      ))}

      {/* the counter: 0/3, then 1/3, 2/3, 3/3, one for each callout as the beam passes */}
      <g
        className="intro-counter"
        style={
          {
            '--t1': `${callouts[0].at.toFixed(2)}s`,
            '--t2': `${callouts[1].at.toFixed(2)}s`,
            '--t3': `${callouts[2].at.toFixed(2)}s`,
          } as CSSProperties
        }
      >
        {[0, 1, 2, 3].map((n) => (
          <text
            key={n}
            className={`intro-count intro-count-${n}`}
            x={L.counter[0]}
            y={L.counter[1]}
            textAnchor="middle"
          >
            {n}/3
          </text>
        ))}
      </g>
    </svg>
  );
}
