import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks the intro of the home page (R70): when it is shown (frontend/src/lib/intro.ts),
// the boot script of the <head> that decides it before the first paint, the
// order of the example run, and the CSS that keeps the intro and the headline
// apart. The frontend has no test runner of its own (see progress.spec.ts), so
// they run here.
type Phase = 'idle' | 'owner' | 'leaked' | 'fixing' | 'blocked';
type Actor = 'owner' | 'user_b' | 'visitor';

interface Context {
  pathname: string;
  reducedMotion: boolean;
  seen: boolean;
  storageOk: boolean;
}

interface IntroModule {
  INTRO_KEY: string;
  INTRO_SCALE: number;
  INTRO_STORY_MS: number;
  INTRO_HOLD_MS: number;
  INTRO_FADE_MS: number;
  INTRO_FALLBACK_MS: number;
  INTRO_END_MS: number;
  INTRO_TOTAL_MS: number;
  INTRO_GRACE_MS: number;
  INTRO_SCENE_MS: Record<
    'draw' | 'beam' | 'contract' | 'word' | 'open',
    number
  >;
  introModeOf(context: Context): 'full' | null;
  remainingMs(elapsedMs: number): number;
  INTRO_BOOT_SCRIPT: string;
  PHASE_AT_MS: Record<'owner' | 'leaked' | 'fixing' | 'blocked', number>;
  phaseAt(phase: 'owner' | 'leaked' | 'fixing' | 'blocked'): number;
  shouldShowIntro(context: Context): boolean;
  chipState(actor: Actor, phase: Phase): string;
}

const FRONTEND = join(process.cwd(), '..', 'frontend');
const intro = (await import(
  /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'intro.ts'))
    .href
)) as IntroModule;
const { shouldShowIntro, chipState, INTRO_BOOT_SCRIPT, INTRO_KEY } = intro;

const read = (...parts: string[]) =>
  readFileSync(join(FRONTEND, 'src', ...parts), 'utf-8');
const css = read('app', 'globals.css');
const introCss = read('app', 'intro.css');

const base: Context = {
  pathname: '/',
  reducedMotion: false,
  seen: false,
  storageOk: true,
};

describe('shouldShowIntro', () => {
  it('shows on the home page, first time in a tab', () => {
    expect(shouldShowIntro(base)).toBe(true);
  });

  it('not on any other page', () => {
    for (const pathname of [
      '/audits/aud_1',
      '/audits/aud_1/report',
      '/x',
      '',
    ]) {
      expect(shouldShowIntro({ ...base, pathname }), pathname).toBe(false);
    }
  });

  it('not a second time in the tab, and not when the flag cannot be kept', () => {
    expect(shouldShowIntro({ ...base, seen: true })).toBe(false);
    expect(shouldShowIntro({ ...base, storageOk: false })).toBe(false);
  });

  it('never with reduced motion', () => {
    expect(intro.introModeOf(base)).toBe('full');
    expect(intro.introModeOf({ ...base, reducedMotion: true })).toBeNull();
    expect(shouldShowIntro({ ...base, reducedMotion: true })).toBe(false);
  });
});

/** Runs the boot script of the <head> in a fake page and tells what it did. */
function runScript(
  options: {
    pathname?: string;
    reduced?: boolean;
    stored?: boolean;
    storageThrows?: 'get' | 'set' | 'access';
  } = {},
) {
  const attributes = new Map<string, string>();
  const store = new Map<string, string>();
  if (options.stored) store.set(INTRO_KEY, '1');
  const timeouts: { fn: () => void; ms: number }[] = [];
  const sessionStorage = {
    getItem: (key: string) => {
      if (options.storageThrows === 'get') throw new Error('blocked');
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (options.storageThrows === 'set') throw new Error('full');
      store.set(key, value);
    },
  };
  const win: Record<string, unknown> = {
    matchMedia: (query: string) => ({
      matches: Boolean(options.reduced) && query.includes('reduce'),
    }),
    get sessionStorage() {
      if (options.storageThrows === 'access') throw new Error('denied');
      return sessionStorage;
    },
  };
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const document = {
    addEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      ),
    documentElement: {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    },
  };
  const setTimeoutFake = (fn: () => void, ms: number) => {
    timeouts.push({ fn, ms });
    return timeouts.length;
  };
  new Function(
    'window',
    'document',
    'location',
    'setTimeout',
    INTRO_BOOT_SCRIPT,
  )(win, document, { pathname: options.pathname ?? '/' }, setTimeoutFake);
  return { attributes, store, timeouts, win, listeners };
}

describe('the boot script of the <head>', () => {
  it('on the first visit of the home page it sets pending and the flag, at once', () => {
    const run = runScript();
    expect(run.attributes.get('data-intro')).toBe('pending');
    expect(run.store.get(INTRO_KEY)).toBe('1');
  });

  it('a refresh or a second visit in the same tab does nothing', () => {
    const run = runScript({ stored: true });
    expect(run.attributes.has('data-intro')).toBe(false);
    expect(run.timeouts).toHaveLength(0);
  });

  it('another page does nothing and does not use the flag', () => {
    const run = runScript({ pathname: '/audits/aud_1' });
    expect(run.attributes.has('data-intro')).toBe(false);
    expect(run.store.size).toBe(0);
  });

  it('reduced motion: no intro at all, no flag, no timer, no listener', () => {
    const run = runScript({ reduced: true });
    expect(run.attributes.size).toBe(0);
    expect(run.store.size).toBe(0);
    expect(run.timeouts).toHaveLength(0);
    expect(run.listeners.size).toBe(0);
  });

  it('a click or Esc skips before the page code is ready (a fade, then done), and only while pending', () => {
    const run = runScript();
    const click = run.listeners.get('click')![0];
    click({ type: 'click' });
    expect(run.attributes.get('data-intro')).toBe('leaving');
    // the failsafe timer was replaced by the short one of the fade
    expect(run.timeouts[run.timeouts.length - 1].ms).toBe(intro.INTRO_FADE_MS);
    run.timeouts[run.timeouts.length - 1].fn();
    expect(run.attributes.get('data-intro')).toBe('done');
    // a later click does nothing
    click({ type: 'click' });
    expect(run.attributes.get('data-intro')).toBe('done');

    const esc = runScript();
    const key = esc.listeners.get('keydown')![0];
    key({ type: 'keydown', key: 'a' });
    expect(esc.attributes.get('data-intro')).toBe('pending');
    key({ type: 'keydown', key: 'Escape' });
    expect(esc.attributes.get('data-intro')).toBe('leaving');
  });

  it('once the page code has taken over, the head script no longer skips', () => {
    const run = runScript();
    run.win.__vcaIntroOwned = true;
    run.listeners.get('click')![0]({ type: 'click' });
    expect(run.attributes.get('data-intro')).toBe('pending');
  });

  it('once per browser session: the second visit does nothing', () => {
    for (const reduced of [false, true]) {
      const run = runScript({ stored: true, reduced });
      expect(run.attributes.has('data-intro')).toBe(false);
      expect(run.timeouts).toHaveLength(0);
    }
  });

  it.each(['get', 'set', 'access'] as const)(
    'storage that fails on %s: no intro, no error',
    (storageThrows) => {
      const run = runScript({ storageThrows });
      expect(run.attributes.has('data-intro')).toBe(false);
    },
  );

  it('arms a timer that ends the intro by itself after 3 s', () => {
    const run = runScript();
    expect(run.timeouts).toHaveLength(1);
    expect(run.timeouts[0].ms).toBe(intro.INTRO_FALLBACK_MS);
    expect(intro.INTRO_FALLBACK_MS).toBe(3000);
    run.timeouts[0].fn();
    expect(run.attributes.get('data-intro')).toBe('done');
    // the page's own code can replace it, so its id is kept
    expect(run.win.__vcaIntroTimer).toBe(1);
  });

  it('agrees with shouldShowIntro for every combination', () => {
    for (const pathname of ['/', '/audits/aud_1']) {
      for (const reduced of [false, true]) {
        for (const stored of [false, true]) {
          for (const failing of [false, true]) {
            const run = runScript({
              pathname,
              reduced,
              stored,
              storageThrows: failing ? 'get' : undefined,
            });
            const wanted = shouldShowIntro({
              pathname,
              reducedMotion: reduced,
              seen: stored,
              storageOk: !failing,
            });
            expect(
              run.attributes.get('data-intro') === 'pending',
              JSON.stringify({ pathname, reduced, stored, failing }),
            ).toBe(wanted);
          }
        }
      }
    }
  });
});

describe('the length of the scene', () => {
  it('is 3 s or less, and the failsafe is 3 s', () => {
    expect(intro.INTRO_END_MS).toBe(2950);
    expect(intro.INTRO_END_MS).toBe(intro.INTRO_STORY_MS + intro.INTRO_HOLD_MS);
    expect(intro.INTRO_END_MS).toBeLessThanOrEqual(intro.INTRO_FALLBACK_MS);
    expect(intro.INTRO_FALLBACK_MS).toBeLessThanOrEqual(3000);
  });

  it('the end is counted from when the scene started, not from when the page code is ready', () => {
    expect(intro.remainingMs(0)).toBe(intro.INTRO_END_MS);
    expect(intro.remainingMs(1000)).toBe(intro.INTRO_END_MS - 1000);
    expect(intro.remainingMs(intro.INTRO_END_MS)).toBe(0);
    expect(intro.remainingMs(99999)).toBe(0);
    expect(intro.remainingMs(-5)).toBe(intro.INTRO_END_MS);
  });

  it('a slow first paint moves the start to the paint, so the end of the scene is not cut', () => {
    const source = read('components', 'intro-overlay.tsx');
    expect(source).toContain("getEntriesByType('paint')");
    expect(source).toContain('Math.max(scoped.__vcaIntroAt, painted.startTime)');
  });

  it('the script keeps the moment it started', () => {
    expect(INTRO_BOOT_SCRIPT).toContain('__vcaIntroAt');
  });
});

describe('the scene: the times of the CSS are the times of lib/intro.ts', () => {
  const variable = (name: string) => {
    const match = introCss.match(new RegExp('--t-' + name + ': ([0-9.]+)s;'));
    expect(match, name).not.toBeNull();
    return Math.round(Number(match![1]) * 1000);
  };

  it('--t-draw, --t-beam, --t-contract, --t-word and --t-open', () => {
    expect(variable('draw')).toBe(intro.INTRO_SCENE_MS.draw);
    expect(variable('beam')).toBe(intro.INTRO_SCENE_MS.beam);
    expect(variable('contract')).toBe(intro.INTRO_SCENE_MS.contract);
    expect(variable('word')).toBe(intro.INTRO_SCENE_MS.word);
    expect(variable('open')).toBe(intro.INTRO_SCENE_MS.open);
  });

  it('draws 0 to 0.7 s, the beam 0.7 to 2 s, the gate 2 to 2.95 s, in this order', () => {
    const t = intro.INTRO_SCENE_MS;
    expect(t.draw).toBe(0);
    expect(t.beam).toBe(700);
    expect(t.contract).toBe(2000);
    expect(t.beam).toBeLessThan(t.contract);
    expect(t.contract).toBeLessThan(t.word);
    expect(t.word).toBeLessThan(t.open);
    expect(t.open).toBeLessThan(intro.INTRO_END_MS);
  });

  it('the beam sweeps for exactly the time between --t-beam and --t-contract (the component computes it)', () => {
    const art = read('components', 'intro-art.tsx');
    expect(art).toContain('INTRO_SCENE_MS.beam');
    expect(art).toContain('INTRO_SCENE_MS.contract');
  });

  it('the panels open at --t-open and the objects leave at --t-contract', () => {
    expect(introCss).toMatch(
      /\.intro-panel-top \{[^}]*animation: introPanelUp [^;]*var\(--t-open\)/,
    );
    expect(introCss).toMatch(
      /\.intro-panel-bottom \{[^}]*animation: introPanelDown [^;]*var\(--t-open\)/,
    );
    expect(introCss).toMatch(
      /\.intro-objects \{\s*animation: introFadeOut [^;]*var\(--t-contract\)/,
    );
    expect(introCss).toMatch(/introRingsFlat [^;]*var\(--t-contract\)/);
  });

  it('the name comes word by word from --t-word, one word after the other', () => {
    expect(introCss).toMatch(
      /\.intro-word \{[^}]*calc\(var\(--t-word\) \+ var\(--w, 0\) \* [0-9.]+s\)/,
    );
    const scene = read('components', 'intro-scene.tsx');
    expect(scene).toContain("PROJECT_NAME.split(' ')");
    expect(scene).toContain("'--w': index");
  });

  it('the scene has the three callouts, in English and Roman Urdu, and a counter 0/3 to 3/3', () => {
    const art = read('components', 'intro-art.tsx');
    for (const text of ['Site headers', 'Scripts', 'Tables']) {
      expect(art).toContain(`en: '${text}'`);
    }
    expect(art).toContain("ur: 'Site ke headers'");
    expect(art).toMatch(/\[0, 1, 2, 3\]\.map/);
    expect(art).toContain('{n}/3');
    for (const n of [0, 1, 2, 3]) {
      expect(introCss).toContain(`.intro-count-${n}`);
    }
  });

  it('the masked lines are dots, never a key', () => {
    const art = read('components', 'intro-art.tsx');
    expect(art).toContain('•');
    expect(art).not.toMatch(/sb_(secret|publishable)|eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('draws two objects (a website and a database) with stroke-dashoffset, with a tall layout for a phone', () => {
    expect(introCss).toMatch(/\.intro-draw \{[^}]*stroke-dashoffset: 1;/);
    expect(introCss).toMatch(
      /@keyframes introDraw \{\s*to \{\s*stroke-dashoffset: 0/,
    );
    expect(introCss).toMatch(/@media \(max-width: 480px\)/);
    const scene = read('components', 'intro-scene.tsx');
    expect(scene).toContain('layout="wide"');
    expect(scene).toContain('layout="tall"');
    const art = read('components', 'intro-art.tsx');
    // tall: the website above, the database below
    expect(art).toMatch(/web: \[70, 92\]/);
    expect(art).toMatch(/db: \[70, 372\]/);
  });

  it('the beam is a piece of its own, with no timers, that another SVG can use', () => {
    const beam = read('components', 'scan-beam.tsx');
    expect(beam).toContain('export function ScanBeam');
    expect(beam).toMatch(/axis: 'x' \| 'y'/);
    expect(beam).not.toMatch(/setTimeout|setInterval|useEffect|useState/);
    expect(introCss).toContain('.scan-beam');
    expect(read('components', 'intro-art.tsx')).toContain('<ScanBeam');
  });

  it('uses the colours of the theme only: no hex, rgb or hsl colour in the scene', () => {
    expect(introCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(introCss).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    for (const file of ['intro-art.tsx', 'intro-scene.tsx', 'scan-beam.tsx']) {
      expect(read('components', file), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('has no lock, no tick, and no word that claims safety (R38, R88)', () => {
    const files = [
      read('components', 'intro-art.tsx'),
      read('components', 'intro-scene.tsx'),
      read('components', 'scan-beam.tsx'),
      introCss,
    ].join('\n');
    expect(files).not.toMatch(
      /\b(lock|shackle|tick|checkmark|verified|safe|secure|certified|guarantee[ds]?)\b/i,
    );
  });
});

describe('the card of the example run keeps its own timeline', () => {
  it('the phases come in order and the list is the one the CSS knows', () => {
    const { owner, leaked, fixing, blocked } = intro.PHASE_AT_MS;
    expect(owner).toBeLessThan(leaked);
    expect(leaked).toBeLessThan(fixing);
    expect(fixing).toBeLessThan(blocked);
    for (const phase of ['idle', 'owner', 'leaked', 'fixing', 'blocked']) {
      const source = read('components', 'hero-motion.tsx');
      expect(source, phase).toContain(`${phase}: {`);
    }
  });
});

describe('the verdict chips', () => {
  const order: Phase[] = ['idle', 'owner', 'leaked', 'fixing', 'blocked'];

  it('an attacker goes waiting, LEAKED, BLOCKED once, and never back to waiting', () => {
    for (const actor of ['user_b', 'visitor'] as const) {
      const states = order.map((phase) => chipState(actor, phase));
      expect(states).toEqual(['idle', 'idle', 'reached', 'reached', 'blocked']);
    }
  });

  it('the owner is allowed from the control check on', () => {
    expect(order.map((phase) => chipState('owner', phase))).toEqual([
      'idle',
      'allowed',
      'allowed',
      'allowed',
      'allowed',
    ]);
  });
});

describe('the example run (CSS and component)', () => {
  const delayOf = (selector: string) => {
    const match = css.match(
      new RegExp(
        `${selector}\\s*\\{\\s*animation:\\s*drawStreak calc\\(([\\d.]+)s \\* var\\(--hs, 1\\)\\) [^;]*? calc\\(([\\d.]+)s \\* var\\(--hs, 1\\)\\)`,
      ),
    );
    expect(match, selector).not.toBeNull();
    return { duration: Number(match![1]), delay: Number(match![2]) };
  };

  it('User B comes before the Visitor, before and after the policy', () => {
    const leakB = delayOf('\\.motion-leak-b');
    const leakV = delayOf('\\.motion-leak-v');
    expect(leakB.delay).toBeLessThan(leakV.delay);
    // the Visitor starts when User B has arrived: one after the other
    expect(leakV.delay).toBeGreaterThanOrEqual(
      leakB.delay + leakB.duration - 0.2,
    );
    const blockB = css.match(
      /\.motion-block-b\s*\{\s*animation: drawStreak calc\(([\d.]+)s[^;]*calc\(([\d.]+)s/,
    );
    const blockV = css.match(
      /\.motion-block-v\s*\{\s*animation: drawStreak calc\(([\d.]+)s[^;]*calc\(([\d.]+)s/,
    );
    expect(Number(blockB![2])).toBeLessThan(Number(blockV![2]));
  });

  it('the scene says Visitor, not Anon, and has no lock (the policy line is the only barrier)', () => {
    const source = read('components', 'hero-motion.tsx');
    expect(source).not.toMatch(/\bAnon\b/);
    expect(source.match(/Visitor/g)!.length).toBeGreaterThanOrEqual(4);
    expect(source).not.toMatch(/motion-lock|shackle/);
    expect(css).not.toMatch(/motion-lock|shackle/);
    expect(source).toContain('motion-gate');
  });

  it('every part of the story is scaled by --hs', () => {
    const scaled = css.match(/var\(--hs, 1\)/g) ?? [];
    expect(scaled.length).toBeGreaterThanOrEqual(15);
    const source = read('components', 'hero-motion.tsx');
    expect(source).toContain("'--hs'");
  });

  it('uses no word that claims safety or a guarantee', () => {
    for (const name of ['hero-motion.tsx', 'intro-overlay.tsx']) {
      expect(read('components', name), name).not.toMatch(
        /\b(?:secure|secured|safe|safely|certified|guarantee[ds]?)\b/i,
      );
    }
    expect(read('lib', 'intro.ts')).not.toMatch(
      /\b(?:secure|secured|safe|safely|certified|guarantee[ds]?)\b/i,
    );
  });
});

describe('the intro and the headline never run together', () => {
  it('the overlay is hidden unless pending, opening or leaving', () => {
    expect(css).toMatch(/\.intro-overlay \{\s*display: none;/);
    expect(css).toMatch(
      /html\[data-intro="pending"\] \.intro-overlay,\s*html\[data-intro="opening"\] \.intro-overlay,\s*html\[data-intro="leaving"\] \.intro-overlay \{[^}]*display: grid/,
    );
  });

  it('a CSS animation removes the overlay by itself after 3 s (while pending and while opening)', () => {
    const match = css.match(
      /html\[data-intro="pending"\] \.intro-overlay,\s*html\[data-intro="opening"\] \.intro-overlay \{\s*animation: introGone [\d.]+s linear ([\d.]+)s forwards/,
    );
    expect(match).not.toBeNull();
    expect(
      Math.abs(Number(match![1]) * 1000 - intro.INTRO_FALLBACK_MS),
    ).toBeLessThan(50);
    expect(css).toMatch(/@keyframes introGone \{\s*to \{\s*visibility: hidden/);
  });

  it('reduced motion shows no overlay, even if the setting changes while it runs', () => {
    const block = introCss.slice(
      introCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(block).toMatch(/html\[data-intro\] \.intro-overlay \{\s*display: none/);
    expect(introCss).not.toContain('data-intro-mode');
  });

  it('the hero moves only after the intro: the words wait while pending, opening and leaving', () => {
    expect(css.replace(/\r\n/g, '\n')).toMatch(
      /html\[data-intro="pending"\] \.hero-word,\s*html\[data-intro="opening"\] \.hero-word,\s*html\[data-intro="leaving"\] \.hero-word \{\s*animation-play-state: paused/,
    );
  });

  it('the boot script comes in the <head> of the layout', () => {
    const layout = read('app', 'layout.tsx');
    expect(layout).toContain('INTRO_BOOT_SCRIPT');
    expect(layout.indexOf('INTRO_BOOT_SCRIPT')).toBeLessThan(
      layout.indexOf('<body'),
    );
  });
});

describe('the overlay belongs to the whole screen (the reason it was cut off)', () => {
  // A wrapper of a card is moved and faded when it comes into view. A
  // `position: fixed` child of such a wrapper would be fixed to it, not to the
  // screen, so the overlay must not live in a page.
  it('the cards of a page are moved by their wrapper (so the rule matters)', () => {
    expect(read('app', 'glass.css')).toMatch(
      /@keyframes revealUp \{[\s\S]*?transform: translateY\(28px\)/,
    );
  });

  it('is rendered directly in <body> of the layout, before the header and the page, not in <main>', () => {
    const layout = read('app', 'layout.tsx');
    const body = layout.slice(layout.indexOf('<body'));
    expect(body).toContain('<IntroOverlay />');
    expect(body.indexOf('<IntroOverlay />')).toBeLessThan(
      body.indexOf('<AppProvider>'),
    );
    expect(body.indexOf('<IntroOverlay />')).toBeLessThan(
      body.indexOf('<main'),
    );
  });

  it('no page uses it, and it is rendered whatever the state (server HTML on an empty sessionStorage)', () => {
    for (const page of [
      ['app', 'page.tsx'],
      ['app', 'audits', '[id]', 'page.tsx'],
      ['app', 'audits', '[id]', 'report', 'page.tsx'],
      ['app', 'audits', '[id]', 'certificate', 'page.tsx'],
    ]) {
      expect(read(...page), page.join('/')).not.toContain('IntroOverlay');
    }
    const source = read('components', 'intro-overlay.tsx');
    // it starts as shown, with no check of window or storage, so the server writes it
    expect(source).toContain('useState(true)');
    expect(source).not.toMatch(/typeof window/);
    expect(source.indexOf('useState(true)')).toBeLessThan(
      source.indexOf('useEffect(() =>'),
    );
    // an empty sessionStorage: the head script says pending
    expect(runScript().attributes.get('data-intro')).toBe('pending');
  });

  const overlayRule = () => {
    const match = css.match(
      /html\[data-intro="pending"\] \.intro-overlay,\s*html\[data-intro="opening"\] \.intro-overlay,\s*html\[data-intro="leaving"\] \.intro-overlay \{([^}]*)\}/,
    );
    expect(match).not.toBeNull();
    return match![1];
  };

  it('is fixed, inset 0, 100dvh high, with scroll locked while it runs', () => {
    const rule = overlayRule();
    expect(rule).toContain('position: fixed;');
    expect(rule).toContain('inset: 0;');
    expect(rule).toContain('height: 100dvh;');
    expect(rule).toContain('place-items: center;');
    expect(css).toMatch(
      /html\[data-intro="pending"\],\s*html\[data-intro="opening"\],\s*html\[data-intro="leaving"\] \{\s*overflow: hidden;/,
    );
    // the two panels carry the background, so a failure of the scene never blanks the page
    expect(rule).toContain('background: transparent;');
  });

  it('its z-index is above the header and above every other z-index of the CSS', () => {
    const z = Number(overlayRule().match(/z-index: (\d+)/)![1]);
    const header = Number(css.match(/\.site-header \{[^}]*z-index: (\d+)/)![1]);
    expect(z).toBeGreaterThan(header);
    const others = [...css.matchAll(/z-index: (\d+)/g)]
      .map((m) => Number(m[1]))
      .filter((value) => value !== z);
    expect(z).toBeGreaterThan(Math.max(...others));
  });

  it('no fixed px height in the intro rules: sizes are in vmin, dvh, vw, % and rem', () => {
    const rules = [
      ...(css + '\n' + introCss).matchAll(/([^{}]*\.intro-[^{}]*)\{([^}]*)\}/g),
    ].map((m) => m[2]);
    expect(rules.length).toBeGreaterThan(8);
    for (const body of rules) {
      expect(body).not.toMatch(/(?:^|[\s;])(?:min-|max-)?height:\s*[\d.]+px/);
      expect(body).not.toMatch(/(?:^|[\s;])(?:min-|max-)?width:\s*[\d.]+px/);
    }
    expect(introCss).toMatch(
      /\.intro-art-wide \{\s*width: min\([\d.]+vw, [\d.]+dvh\)/,
    );
    expect(introCss).toMatch(
      /\.intro-art-tall \{[^}]*height: min\([\d.]+dvh, [\d.]+vw\)/,
    );
    expect(introCss).toMatch(
      /\.intro-name \{[^}]*font-size: max\([\d.]+rem, [\d.]+vmin\)/,
    );
  });

});

describe('skipping and the keyboard', () => {
  const source = read('components', 'intro-overlay.tsx');

  it('tap, click, Esc and a Skip button end it; the Skip button gets the focus', () => {
    expect(source).toContain('onClick={close}');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('INTRO_COPY.skip');
    expect(source).toContain('skipButton.current?.focus');
  });

  it('Tab cannot leave the overlay, and it is a dialog', () => {
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
  });

  it('ends with the gate (opening), then done; a skip ends with a fade; and a limit ends it anyway', () => {
    expect(source).toContain("'opening'");
    expect(source).toContain("'leaving'");
    expect(source).toContain("'done'");
    expect(source).toContain('INTRO_FADE_MS');
    expect(source).toContain('INTRO_FALLBACK_MS');
    expect(source).toContain('INTRO_GRACE_MS');
    // the limit: the normal end plus the fade plus the grace, never more than the failsafe
    expect(source).toContain(
      'Math.min(left + INTRO_FADE_MS + INTRO_GRACE_MS, INTRO_FALLBACK_MS)',
    );
  });

  it('the Skip button is always there', () => {
    expect(source).toContain('INTRO_COPY.skip');
    expect(source).toContain('onClick={close}');
  });

  it('takes over the time limit from the head script, counted from its own start', () => {
    expect(source).toContain('__vcaIntroTimer');
    expect(source).toContain('clearTimeout(scoped.__vcaIntroTimer)');
  });

  it('a replay does nothing with reduced motion', () => {
    expect(source).toMatch(
      /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/,
    );
  });
});

describe('the replay button and the theme button', () => {
  const copy = read('lib', 'hero-copy.ts');
  const plain = css.replace(/\r\n/g, '\n');

  it('the replay button shows on every width, and not at all with reduced motion', () => {
    expect(plain).toMatch(/\n\.hero-replay \{\s*display: inline-flex;/);
    expect(plain).not.toMatch(/\.hero-replay \{\s*display: none;/);
    expect(plain).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.hero-replay,\s*\.motion-controls \{\s*display: none !important;/,
    );
  });

  it('a click asks the overlay to play again', () => {
    const footer = read('components', 'site-footer.tsx');
    expect(footer).toContain("new Event('vca:replay-hero')");
    expect(read('components', 'intro-overlay.tsx')).toContain(
      "addEventListener('vca:replay-hero', replay)",
    );
  });

  it('both speak English and Roman Urdu', () => {
    expect(read('components', 'site-footer.tsx')).toContain('{pickText(REPLAY, lang)}');
    const toggle = read('components', 'theme-toggle.tsx');
    expect(toggle).toContain('useLang()');
    expect(toggle).toContain('pickText(other.word, lang)');
    expect(toggle).toContain('pickText(other.action, lang)');
    for (const words of [
      "en: 'Replay intro'",
      "ur: 'Intro dobara chalayein'",
      "{ en: 'Light', ur: 'Roshan' }",
      "{ en: 'Dark', ur: 'Andhera' }",
      "ur: 'Roshan theme lagayein'",
      "ur: 'Andhera theme lagayein'",
    ]) {
      expect(copy).toContain(words);
    }
  });

  it('a replay has the same time limits: in the page code and in the CSS', () => {
    const overlay = read('components', 'intro-overlay.tsx');
    expect(overlay).toContain('begin(true)');
    expect(overlay).toContain('INTRO_FALLBACK_MS');
    expect(plain).toContain('animation: introGone 0.01s linear 3s forwards;');
  });
});

