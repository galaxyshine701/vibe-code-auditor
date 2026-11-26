'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INTRO_FADE_MS,
  INTRO_FALLBACK_MS,
  INTRO_GRACE_MS,
  INTRO_STORY_MS,
  remainingMs,
} from '@/lib/intro';
import { INTRO_COPY, pickText } from '@/lib/hero-copy';
import { useLang } from '@/lib/use-lang';
import { IntroScene } from './intro-scene';

type IntroWindow = Window & {
  __vcaIntroTimer?: number;
  __vcaIntroAt?: number;
  __vcaIntroOwned?: boolean;
};

// The intro of the home page (R70): a scene on the whole screen, once per tab.
// The <head> script (lib/intro.ts) has already decided and set
// `data-intro="pending"` on <html> before the first
// paint; the CSS shows this overlay only then. With reduced motion there is no
// intro: the head script never says "pending", and a replay does nothing.
//
//   pending  the scene runs; the headline waits (CSS)
//   opening  the gate splits open by CSS; the headline starts to rise
//   leaving  the overlay fades out after a skip
//   done     the overlay is gone
//
// A tap, a click, Esc or the Skip button ends it at any moment.
//
// This component sits directly in <body> (layout.tsx), never inside the page:
// the page's wrapper has an animation with a `transform`, and a `position:
// fixed` child of such an element is fixed to the wrapper, not to the screen
// (and its z-index cannot get above the header).
//
// If this code never runs, the timer of the head script sets "done", and a CSS
// animation hides the overlay by itself: the app is never blocked.
export function IntroOverlay() {
  const [mounted, setMounted] = useState(true);
  const [lang] = useLang();
  const [runId, setRunId] = useState(0);
  const skipButton = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const active = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

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

  const root = () => document.documentElement;
  /** Ends the intro with a fade (the scene ended, or the user skipped it). */
  const close = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    clearTimers();
    root().setAttribute('data-intro', 'leaving');
    timers.current.push(
      window.setTimeout(() => {
        root().setAttribute('data-intro', 'done');
        setMounted(false);
        const back = returnFocus.current;
        returnFocus.current = null;
        if (back && document.contains(back)) back.focus({ preventScroll: true });
        nudgeAccessCode();
      }, INTRO_FADE_MS),
    );
  }, [clearTimers, nudgeAccessCode]);

  /** The natural end of the full scene: the gate has opened, the overlay goes. */
  const finish = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    clearTimers();
    root().setAttribute('data-intro', 'done');
    setMounted(false);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
    nudgeAccessCode();
  }, [clearTimers, nudgeAccessCode]);

  /**
   * Starts (or restarts) the intro. The end is counted from when the scene
   * was first on the screen (its CSS starts at the first paint; for a replay:
   * now), and this code now owns the time limit.
   */
  const begin = useCallback(
    (replay: boolean) => {
      const scoped = window as IntroWindow;
      // from now on this code handles a skip (the head script stops doing it)
      scoped.__vcaIntroOwned = true;
      if (scoped.__vcaIntroTimer !== undefined) {
        window.clearTimeout(scoped.__vcaIntroTimer);
        scoped.__vcaIntroTimer = undefined;
      }
      clearTimers();
      const now = window.performance.now();
      if (replay || scoped.__vcaIntroAt === undefined) {
        scoped.__vcaIntroAt = now;
      } else {
        // a slow first paint must not cut the end of the scene
        const painted = window.performance.getEntriesByType('paint')[0];
        if (painted) {
          scoped.__vcaIntroAt = Math.max(scoped.__vcaIntroAt, painted.startTime);
        }
      }
      const elapsed = now - scoped.__vcaIntroAt;
      const left = remainingMs(elapsed);
      active.current = true;
      root().setAttribute('data-intro', 'pending');
      setMounted(true);
      // the gate opens at the end of the story, and the scene is over a moment later
      timers.current.push(
        window.setTimeout(
          () => {
            if (active.current) root().setAttribute('data-intro', 'opening');
          },
          Math.max(0, INTRO_STORY_MS - elapsed),
        ),
      );
      timers.current.push(window.setTimeout(finish, left));
      // the limit: never more than 3 s from here, then it is gone whatever happened
      timers.current.push(
        window.setTimeout(
          () => {
            active.current = false;
            root().setAttribute('data-intro', 'done');
            setMounted(false);
          },
          Math.min(left + INTRO_FADE_MS + INTRO_GRACE_MS, INTRO_FALLBACK_MS),
        ),
      );
      window.requestAnimationFrame(() =>
        skipButton.current?.focus({ preventScroll: true }),
      );
    },
    [clearTimers, finish],
  );

  useEffect(() => {
    if (root().getAttribute('data-intro') === 'pending') begin(false);
    else setMounted(false);

    const replay = () => {
      if (active.current) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const focused = document.activeElement;
      returnFocus.current =
        focused instanceof HTMLElement && focused !== document.body ? focused : null;
      setRunId((id) => id + 1);
      begin(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!active.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        // the page behind is not reachable while the intro runs
        event.preventDefault();
        skipButton.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('vca:replay-hero', replay);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('vca:replay-hero', replay);
      window.removeEventListener('keydown', onKey);
      clearTimers();
    };
  }, [begin, close, clearTimers]);

  if (!mounted) return null;

  return (
    <div
      className="intro-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={pickText(INTRO_COPY.label, lang)}
      onClick={close}
    >
      <IntroScene key={runId} />
      <button
        type="button"
        className="button intro-skip"
        ref={skipButton}
        onClick={close}
      >
        {pickText(INTRO_COPY.skip, lang)}
      </button>
      <p className="intro-hint">{pickText(INTRO_COPY.hint, lang)}</p>
    </div>
  );
}
