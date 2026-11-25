import type { CSSProperties } from 'react';
import { PROJECT_NAME } from '@/lib/brand';
import { IntroArt } from './intro-art';

// The scene of the intro (R70), under 3 s, with no state and no timers. It is
// all CSS animation (intro.css), so it starts at the first paint of the server's
// HTML and does not wait for the page's code.
//
//   0 to 0.7 s   a grid, a website and a database draw on, rings turn
//   0.7 to 2 s   a beam sweeps over them; callouts and a counter appear
//   2 to 2.95 s  the rings contract into a thin gate line, the name appears word
//                by word, then the gate splits open from the centre: the two
//                halves of the screen slide away and the page is there
//
// The name has a word per <span>, so a name of several words appears word by word.
export function IntroScene() {
  const words = PROJECT_NAME.split(' ');
  return (
    <div className="intro-scene">
      <div className="intro-panel intro-panel-top" aria-hidden="true" />
      <div className="intro-panel intro-panel-bottom" aria-hidden="true" />
      <div className="intro-stage">
        <IntroArt layout="wide" />
        <IntroArt layout="tall" />
      </div>
      <div className="intro-gate" aria-hidden="true" />
      <p className="intro-name" aria-label={PROJECT_NAME}>
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            className="intro-word"
            style={{ '--w': index } as CSSProperties}
            aria-hidden="true"
          >
            {word}
          </span>
        ))}
      </p>
    </div>
  );
}
