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

// The intro of the home page (R70): a short scene over the picture of the hero,
// once per tab, one second at most. The <head> script (lib/intro.ts) has already
// decided and set `data-intro="pending"` on <html> before the first paint; the
// CSS shows this layer only then. With reduced motion there is no intro: the head
// script never says "pending", and a replay does nothing.
//
//   pending  the scene runs; the picture below it waits (CSS)
//   opening  the gate splits open by CSS
//   leaving  the layer fades out after a skip
//   done     the layer is gone
//
// It blocks nothing: no scroll lock, no focus taken or held, and clicks go
// through it. A tap or a click anywhere, Esc or the Skip button ends it, and the
// click still does what it was meant to do.
//
// It sits in the hero of the home page (page.tsx), over the scene. If this code
// never runs, the timer of the head script sets "done", and a CSS animation hides
// the layer by itself.
export function IntroOverlay() {
  const [mounted, setMounted] = useState(true);
  const [lang] = useLang();
  const [runId, setRunId] = useState(0);
  const timers = useRef<number[]>([]);
  const active = useRef(false);
  const startedAt = useRef(0);

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
        nudgeAccessCode();
      }, INTRO_FADE_MS),
    );
  }, [clearTimers, nudgeAccessCode]);

  /** The natural end of the scene: the gate has opened, the layer goes. */
  const finish = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    clearTimers();
    root().setAttribute('data-intro', 'done');
    setMounted(false);
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
      startedAt.current = now;
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
      // the limit: never more than 1 s from here, then it is gone whatever happened
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
    },
    [clearTimers, finish],
  );

  useEffect(() => {
    if (root().getAttribute('data-intro') === 'pending') begin(false);
    else setMounted(false);

    const replay = () => {
      if (active.current) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      // the picture is brought into view, where the scene plays
      document
        .querySelector('.hero-visual')
        ?.scrollIntoView({ block: 'nearest' });
      setRunId((id) => id + 1);
      begin(true);
    };
    // neither is stopped: the key and the click still do their own work
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onClick = (event: MouseEvent) => {
      // not the click that asked for this replay
      if (event.timeStamp >= startedAt.current) close();
    };
    window.addEventListener('vca:replay-hero', replay);
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('vca:replay-hero', replay);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      clearTimers();
    };
  }, [begin, close, clearTimers]);

  if (!mounted) return null;

  return (
    <div
      className="intro-overlay"
      role="region"
      aria-label={pickText(INTRO_COPY.label, lang)}
    >
      <IntroScene key={runId} />
      <button
        type="button"
        className="button intro-skip"
        onClick={close}
      >
        {pickText(INTRO_COPY.skip, lang)}
      </button>
      <p className="intro-hint">{pickText(INTRO_COPY.hint, lang)}</p>
    </div>
  );
}
