'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { INTRO_FADE_MS, INTRO_FALLBACK_MS } from '@/lib/intro';
import { HeroMotion } from './hero-motion';

type IntroWindow = Window & { __vcaIntroTimer?: number };

// The intro of the home page (R70): the example run on the whole screen, once per
// tab. The <head> script (lib/intro.ts) has already decided and set
// `data-intro="pending"` on <html> before the first paint; the CSS shows this
// overlay only then. The page's own headline waits (CSS) until `data-intro` is
// "done", so the two never run together.
//
//   pending  the scene runs
//   leaving  the overlay fades out (the headline still waits)
//   done     the overlay is gone, the headline starts
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

  /** Ends the intro with a fade (the story ended, or the user skipped it). */
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

  /** Starts (or restarts) the intro. This code now owns the time limit. */
  const begin = useCallback(() => {
    const scoped = window as IntroWindow;
    if (scoped.__vcaIntroTimer !== undefined) {
      window.clearTimeout(scoped.__vcaIntroTimer);
      scoped.__vcaIntroTimer = undefined;
    }
    clearTimers();
    active.current = true;
    root().setAttribute('data-intro', 'pending');
    setMounted(true);
    // the limit: the story plus 1.5 s, then it is gone whatever happened
    timers.current.push(
      window.setTimeout(() => {
        active.current = false;
        root().setAttribute('data-intro', 'done');
        setMounted(false);
      }, INTRO_FALLBACK_MS),
    );
    window.requestAnimationFrame(() => skipButton.current?.focus({ preventScroll: true }));
  }, [clearTimers]);

  useEffect(() => {
    if (root().getAttribute('data-intro') === 'pending') begin();
    else setMounted(false);

    const replay = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (active.current) return;
      const focused = document.activeElement;
      returnFocus.current =
        focused instanceof HTMLElement && focused !== document.body ? focused : null;
      setRunId((id) => id + 1);
      begin();
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
      aria-label="Introduction: an example run"
      onClick={close}
    >
      <div className="intro-body">
        <HeroMotion mode="intro" onFinish={close} key={runId} />
        <button
          type="button"
          className="button intro-skip"
          ref={skipButton}
          onClick={close}
        >
          Skip intro
        </button>
        <p className="intro-hint muted small">Tap, click or press Esc to skip.</p>
      </div>
    </div>
  );
}
