import { PROJECT_NAME } from '@/lib/brand';

// The scene of the intro (R70): a logo reveal, with no state and no timers. It is
// all CSS animation, so it starts at the first paint of the server's HTML and
// does not wait for the page's code. The order: the canary dot comes, the lock
// appears open (a soft red pulse: the alarm), the lock closes (green: calm), the
// name. The sizes are in vmin (the smaller of the width and the height of the
// screen), so nothing is cut on a wide screen or on a phone.
export function IntroScene() {
  return (
    <div className="intro-scene">
      <svg
        className="intro-mark"
        viewBox="0 0 200 200"
        role="img"
        aria-label="A canary dot inside a lock that opens, then closes"
      >
        <circle className="intro-glow" cx="100" cy="128" r="70" />
        <circle className="intro-pulse intro-pulse-alarm" cx="100" cy="128" r="14" />
        <circle className="intro-pulse intro-pulse-calm" cx="100" cy="128" r="14" />
        <g className="intro-lock">
          <path
            className="intro-shackle"
            d="M76 98 V74 a24 24 0 0 1 48 0 V98"
            fill="none"
          />
          <rect className="intro-body" x="58" y="96" width="84" height="66" rx="15" />
        </g>
        <circle className="intro-dot" cx="100" cy="128" r="13" />
      </svg>
      <p className="intro-name">{PROJECT_NAME}</p>
    </div>
  );
}
