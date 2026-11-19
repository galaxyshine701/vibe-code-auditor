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

  it('not with reduced motion, not a second time, not when the flag cannot be kept', () => {
    expect(shouldShowIntro({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldShowIntro({ ...base, seen: true })).toBe(false);
    expect(shouldShowIntro({ ...base, storageOk: false })).toBe(false);
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
  const document = {
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
  return { attributes, store, timeouts, win };
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

  it('reduced motion does nothing and does not use the flag', () => {
    const run = runScript({ reduced: true });
    expect(run.attributes.has('data-intro')).toBe(false);
    expect(run.store.size).toBe(0);
  });

  it.each(['get', 'set', 'access'] as const)(
    'storage that fails on %s: no intro, no error',
    (storageThrows) => {
      const run = runScript({ storageThrows });
      expect(run.attributes.has('data-intro')).toBe(false);
    },
  );

  it('arms a timer that ends the intro by itself after 5 s', () => {
    const run = runScript();
    expect(run.timeouts).toHaveLength(1);
    expect(run.timeouts[0].ms).toBe(intro.INTRO_FALLBACK_MS);
    expect(intro.INTRO_FALLBACK_MS).toBe(5000);
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

describe('the length of the logo scene', () => {
  it('is 3 s or less in all, fade included', () => {
    expect(intro.INTRO_TOTAL_MS).toBeLessThanOrEqual(3000);
    expect(intro.INTRO_TOTAL_MS).toBe(
      intro.INTRO_STORY_MS + intro.INTRO_HOLD_MS + intro.INTRO_FADE_MS,
    );
    expect(intro.INTRO_TOTAL_MS).toBeLessThan(intro.INTRO_FALLBACK_MS);
  });

  it('the end is counted from when the scene started, not from when the page code is ready', () => {
    expect(intro.remainingMs(0)).toBe(intro.INTRO_END_MS);
    expect(intro.remainingMs(1000)).toBe(intro.INTRO_END_MS - 1000);
    expect(intro.remainingMs(intro.INTRO_END_MS)).toBe(0);
    expect(intro.remainingMs(99999)).toBe(0);
    expect(intro.remainingMs(-5)).toBe(intro.INTRO_END_MS);
  });

  it('the script keeps the moment it started', () => {
    expect(INTRO_BOOT_SCRIPT).toContain('__vcaIntroAt');
  });

  it('every animation of the scene ends within the story, in this order: dot, lock, alarm, lock closes, calm, name', () => {
    const delayOf = (selector: string) => {
      const rule = css.match(
        new RegExp(selector + '\\s*\\{[^}]*?animation:\\s*([^;]+);'),
      );
      expect(rule, selector).not.toBeNull();
      // the first animation of the rule: name, duration, easing, delay
      const first = rule![1].split(',')[0];
      const times = [...first.matchAll(/([\d.]+)s\b/g)].map((m) =>
        Number(m[1]),
      );
      return { duration: times[0], delay: times[1] ?? 0 };
    };
    const dot = delayOf('\\.intro-dot');
    const lock = delayOf('\\.intro-lock');
    const alarm = delayOf('\\.intro-pulse-alarm');
    const closes = delayOf('\\.intro-shackle');
    const calm = delayOf('\\.intro-pulse-calm');
    const name = delayOf('\\.intro-name');
    expect(dot.delay).toBeLessThan(lock.delay);
    expect(lock.delay).toBeLessThanOrEqual(alarm.delay);
    expect(alarm.delay).toBeLessThan(closes.delay);
    expect(closes.delay).toBeLessThan(calm.delay);
    expect(calm.delay).toBeLessThan(name.delay);
    for (const part of [dot, lock, alarm, closes, calm, name]) {
      expect(part.delay + part.duration).toBeLessThanOrEqual(
        intro.INTRO_STORY_MS / 1000,
      );
    }
    // the lock turns from red to green: the alarm, then the calm
    expect(css).toMatch(/\.intro-body \{[^}]*stroke: var\(--leak\)/);
    expect(css).toMatch(
      /@keyframes introToCalm \{\s*to \{\s*stroke: var\(--ok\)/,
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

  it('the scene says Visitor, not Anon, and has a lock that opens and closes', () => {
    const source = read('components', 'hero-motion.tsx');
    expect(source).not.toMatch(/\bAnon\b/);
    expect(source.match(/Visitor/g)!.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('motion-lock-shackle');
    expect(css).toMatch(
      /\[data-phase="leaked"\] \.motion-lock-shackle \{[^}]*rotate/,
    );
    expect(css).toMatch(
      /\.motion-stage\.is-final \.motion-lock-shackle \{[^}]*transform: none/,
    );
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
  it('the overlay is hidden unless pending or leaving', () => {
    expect(css).toMatch(/\.intro-overlay \{\s*display: none;/);
    expect(css).toMatch(
      /html\[data-intro="pending"\] \.intro-overlay,\s*html\[data-intro="leaving"\] \.intro-overlay \{[^}]*display: grid/,
    );
  });

  it('the headline words wait while the intro is pending or leaving', () => {
    expect(css).toMatch(
      /html\[data-intro="pending"\] \.hero-word,\s*html\[data-intro="leaving"\] \.hero-word \{\s*animation-play-state: paused/,
    );
  });

  it('a CSS animation removes the overlay by itself after 5 s', () => {
    const match = css.match(
      /html\[data-intro="pending"\] \.intro-overlay \{\s*animation: introGone [\d.]+s linear ([\d.]+)s forwards/,
    );
    expect(match).not.toBeNull();
    expect(
      Math.abs(Number(match![1]) * 1000 - intro.INTRO_FALLBACK_MS),
    ).toBeLessThan(50);
    expect(css).toMatch(/@keyframes introGone \{\s*to \{\s*visibility: hidden/);
  });

  it('reduced motion hides the overlay whatever the script did', () => {
    const block = css.slice(
      css.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(block).toContain('.intro-overlay');
    expect(block).toContain('display: none !important');
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
  // The page's wrapper (.page-stack) has an animation that ends with
  // `transform: translateY(0)` and `both`. A `position: fixed` child of an
  // element with a transform is fixed to that element, not to the screen, and
  // its z-index stays inside that element's own stacking context, below the
  // header. So the overlay must not live in a page.
  it('the animation of the page wrapper that does this is still there (so the rule matters)', () => {
    expect(css).toMatch(/\.page-stack \{[^}]*animation: rise [^;]*both;/);
    expect(css).toMatch(
      /@keyframes rise \{[\s\S]*?to \{[^}]*transform: translateY\(0\)/,
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
      /html\[data-intro="pending"\] \.intro-overlay,\s*html\[data-intro="leaving"\] \.intro-overlay \{([^}]*)\}/,
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
      /html\[data-intro="pending"\],\s*html\[data-intro="leaving"\] \{\s*overflow: hidden;/,
    );
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

  it('no fixed px height in the intro rules: sizes are in vmin, dvh and rem', () => {
    const rules = [...css.matchAll(/([^{}]*\.intro-[^{}]*)\{([^}]*)\}/g)].map(
      (m) => m[2],
    );
    expect(rules.length).toBeGreaterThan(8);
    for (const body of rules) {
      expect(body).not.toMatch(/(?:^|[\s;])(?:min-|max-)?height:\s*[\d.]+px/);
      expect(body).not.toMatch(/(?:^|[\s;])(?:min-|max-)?width:\s*[\d.]+px/);
    }
    expect(css).toMatch(
      /\.intro-mark \{[^}]*width: [\d.]+vmin;[^}]*height: [\d.]+vmin;/,
    );
    expect(css).toMatch(
      /\.intro-name \{[^}]*font-size: max\([\d.]+rem, [\d.]+vmin\)/,
    );
  });

  it('reduced motion: no intro (the script does nothing and the CSS hides the overlay)', () => {
    expect(runScript({ reduced: true }).attributes.has('data-intro')).toBe(
      false,
    );
    const block = css.slice(
      css.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(block).toContain('.intro-overlay');
  });
});

describe('skipping and the keyboard', () => {
  const source = read('components', 'intro-overlay.tsx');

  it('tap, click, Esc and a Skip button end it; the Skip button gets the focus', () => {
    expect(source).toContain('onClick={close}');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('Skip intro');
    expect(source).toContain('skipButton.current?.focus');
  });

  it('Tab cannot leave the overlay, and it is a dialog', () => {
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
  });

  it('ends with a fade, then done; and a limit that ends it anyway', () => {
    expect(source).toContain("'leaving'");
    expect(source).toContain("'done'");
    expect(source).toContain('INTRO_FADE_MS');
    expect(source).toContain('INTRO_FALLBACK_MS');
  });

  it('takes over the time limit from the head script, counted from its own start', () => {
    expect(source).toContain('__vcaIntroTimer');
    expect(source).toContain('clearTimeout(scoped.__vcaIntroTimer)');
  });

  it('the replay does nothing with reduced motion', () => {
    expect(source).toContain('prefers-reduced-motion: reduce');
  });
});
