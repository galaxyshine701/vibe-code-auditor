'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INTRO_FADE_MS,
  INTRO_FALLBACK_MS,
  INTRO_GRACE_MS,
  remainingMs,
} from '@/lib/intro';
import { IntroScene } from './intro-scene';

type IntroWindow = Window & {
  __vcaIntroTimer?: number;
  __vcaIntroAt?: number;
};

// The intro of the home page (R70): a logo scene on the whole screen, once per
// tab. The <head> script (lib/intro.ts) has already decided and set
// `data-intro="pending"` on <html> before the first paint; the CSS shows this
// overlay only then. The page's own headline waits (CSS) until `data-intro` is
// "done", so the two never run together.
//
//   pending  the scene runs
//   leaving  the overlay fades out (the headline still waits)
//   done     the overlay is gone, the headline starts
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

  /**
   * Starts (or restarts) the intro. The end is counted from when the scene
   * started (the head script, or now for a replay), and this code now owns the
   * time limit.
   */
  const begin = useCallback(
    (replay: boolean) => {
      const scoped = window as IntroWindow;
      if (scoped.__vcaIntroTimer !== undefined) {
        window.clearTimeout(scoped.__vcaIntroTimer);
        scoped.__vcaIntroTimer = undefined;
      }
      clearTimers();
      const now = window.performance.now();
      if (replay || scoped.__vcaIntroAt === undefined) scoped.__vcaIntroAt = now;
      const left = remainingMs(now - scoped.__vcaIntroAt);
      active.current = true;
      root().setAttribute('data-intro', 'pending');
      setMounted(true);
      timers.current.push(window.setTimeout(close, left));
      // the limit: the normal end plus 1.5 s, then it is gone whatever happened
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
    [clearTimers, close],
  );

  useEffect(() => {
    if (root().getAttribute('data-intro') === 'pending') begin(false);
    else setMounted(false);

    const replay = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (active.current) return;
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
      aria-label="Introduction"
      onClick={close}
    >
      <IntroScene key={runId} />
      <button
        type="button"
        className="button intro-skip"
        ref={skipButton}
        onClick={close}
      >
        Skip intro
      </button>
      <p className="intro-hint">Tap, click or press Esc to skip.</p>
    </div>
  );
}
