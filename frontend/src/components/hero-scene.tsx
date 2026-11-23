import type { Lang } from '@/lib/check-labels';
import { SCENE, pickText } from '@/lib/hero-copy';

// The scene above the rows of the example run (flat vector, one inline SVG, the
// motion is CSS in glass.css; no library):
//
//   1  a canary on a checkpoint post        a soft glow around the canary
//   2  a stranger stopped at a striped      the barrier comes down, BLOCKED
//      barrier
//   3  an app being built, with a key       a soft glow around the window of the
//      left in a window                     key, LEAKED
//
// Depth is a gradient on the post and the app and a soft shadow on the ground;
// the glow is a radial gradient (no blur filter, so it is light on a phone). It
// moves once, with transform and opacity only, and it is still (its last frame)
// with reduced motion and on a phone. No lock and no tick: a verdict is the
// word under the picture, the colour and the shape. All of it is an example,
// and the card around it says so ("Example, not a real audit").
export function HeroScene({ lang }: { lang: Lang }) {
  return (
    <figure className="hero-scene" aria-label={pickText(SCENE.label, lang)}>
      <svg
        className="scene-art"
        viewBox="0 0 360 118"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="scene-depth" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--scene-lit)" />
            <stop offset="1" stopColor="var(--scene-shade)" />
          </linearGradient>
          <radialGradient id="scene-glow-canary">
            <stop offset="0" stopColor="var(--canary)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--canary)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="scene-glow-key">
            <stop offset="0" stopColor="var(--leak)" stopOpacity="0.5" />
            <stop offset="1" stopColor="var(--leak)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="scene-shadow-fill">
            <stop offset="0" stopColor="#000" stopOpacity="0.5" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <pattern
            id="scene-stripes"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="12" className="scene-stripe-a" />
            <rect x="6" width="6" height="12" className="scene-stripe-b" />
          </pattern>
        </defs>

        <path className="scene-ground" d="M6 100H354" />

        {/* 1: the canary on its post */}
        <g className="scene-part scene-part-canary">
          <ellipse className="scene-shadow" cx="60" cy="101" rx="28" ry="4.5" />
          <rect className="scene-post" x="54" y="58" width="12" height="42" rx="3" />
          <rect className="scene-post-cap" x="46" y="51" width="28" height="9" rx="3" />
          <path className="scene-post-band" d="M54 80H66" />
          <circle className="scene-glow scene-glow-canary" cx="60" cy="38" r="32" />
          <g className="scene-canary">
            <path className="scene-canary-tail" d="M50 42 40 47 51 48Z" />
            <ellipse className="scene-canary-body" cx="59" cy="41" rx="11" ry="9" />
            <circle className="scene-canary-body" cx="69" cy="33.5" r="6.5" />
            <path className="scene-canary-beak" d="M74.5 32.6 81.5 35.2 74.5 37.4Z" />
            <path className="scene-canary-wing" d="M52 40Q57 33 63 42Q57 47 52 40Z" />
            <circle className="scene-canary-eye" cx="71" cy="32.2" r="1.2" />
          </g>
        </g>

        {/* 2: a stranger stopped at a striped barrier */}
        <g className="scene-part scene-part-barrier">
          <ellipse className="scene-shadow" cx="160" cy="101" rx="42" ry="4.5" />
          <g className="scene-stranger">
            <circle className="scene-stranger-body" cx="134" cy="62" r="8" />
            <path
              className="scene-stranger-body"
              d="M121 100V84a13 13 0 0 1 26 0V100Z"
            />
          </g>
          <rect className="scene-barrier-post" x="168" y="58" width="6" height="42" rx="2" />
          <rect className="scene-barrier-post" x="204" y="58" width="6" height="42" rx="2" />
          <rect className="scene-barrier-bar" x="168" y="64" width="42" height="11" rx="2" />
        </g>

        {/* 3: an app being built, with a key left in a window */}
        <g className="scene-part scene-part-key">
          <ellipse className="scene-shadow" cx="300" cy="101" rx="46" ry="4.5" />
          <rect className="scene-app" x="252" y="34" width="96" height="66" rx="7" />
          <path className="scene-app-bar" d="M252 41a7 7 0 0 1 7-7H341a7 7 0 0 1 7 7V46H252Z" />
          <circle className="scene-app-dot" cx="260" cy="40" r="1.8" />
          <circle className="scene-app-dot" cx="267" cy="40" r="1.8" />
          <circle className="scene-app-dot" cx="274" cy="40" r="1.8" />
          <rect className="scene-brick" x="316" y="54" width="24" height="9" rx="2" />
          <rect className="scene-brick scene-brick-todo" x="316" y="68" width="24" height="9" rx="2" />
          <rect className="scene-brick scene-brick-todo" x="316" y="82" width="24" height="9" rx="2" />
          <circle className="scene-glow scene-glow-key" cx="282" cy="71" r="34" />
          <rect className="scene-window" x="262" y="55" width="40" height="32" rx="5" />
          <g className="scene-key">
            <circle cx="274" cy="71" r="5.5" />
            <path d="M279.5 71H295M289 71v6M294 71v4.5" />
          </g>
        </g>
      </svg>

      <figcaption className="scene-captions">
        <span className="scene-caption">
          <strong>{pickText(SCENE.canary.title, lang)}</strong>
          <span>{pickText(SCENE.canary.note, lang)}</span>
        </span>
        <span className="scene-caption">
          <strong>{pickText(SCENE.barrier.title, lang)}</strong>
          <span className="scene-word scene-word-blocked">{SCENE.barrier.verdict}</span>
        </span>
        <span className="scene-caption">
          <strong>{pickText(SCENE.key.title, lang)}</strong>
          <span className="scene-word scene-word-leaked">{SCENE.key.verdict}</span>
        </span>
      </figcaption>
    </figure>
  );
}
