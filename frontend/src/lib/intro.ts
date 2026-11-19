// The opening of the home page (R70): a short logo scene fills the screen once
// per tab, then the page shows its headline. The rules of "when" are here, in
// plain functions, so they can be tested. The boot script at the bottom is the
// same rule written as text: it runs in the <head> before the first paint (like
// the theme script), so the page never shows before the intro.

/** sessionStorage key: set when the intro starts, so a refresh in the same tab skips it. */
export const INTRO_KEY = 'vca-intro-v1';

// ---- The logo scene: the dot, the lock opens (alarm), the lock closes (calm), the name ----

/** The last thing of the scene (the name) is fully shown at this time. */
export const INTRO_STORY_MS = 2200;
/** The last frame stays this long before the overlay fades. */
export const INTRO_HOLD_MS = 400;
/** The fade of the overlay. */
export const INTRO_FADE_MS = 350;
/** The fade begins here. */
export const INTRO_END_MS = INTRO_STORY_MS + INTRO_HOLD_MS;
/** The whole intro, fade included: 3 s or less. */
export const INTRO_TOTAL_MS = INTRO_END_MS + INTRO_FADE_MS;
/** If nothing has ended the intro by then, it is removed anyway (the head script and the CSS use it too). */
export const INTRO_FALLBACK_MS = 5000;
/** After the page's own code has taken over, it gets this long beyond the normal end. */
export const INTRO_GRACE_MS = 1500;

// ---- The card of the example run (the hero's last frame). Its own timeline, kept for its "intro" mode. ----

/** The card's story as first written took 6.6 s. One number scales every delay of it (CSS and timers). */
export const INTRO_SCALE = 0.53;

/** When each phase of the card's example run starts, in the unscaled time of the first version (ms). */
export const PHASE_AT_MS = {
  owner: 2300,
  leaked: 3450,
  fixing: 4900,
  blocked: 6600,
} as const;

/** The card's whole story in real time. */
export const CARD_STORY_MS = Math.round(PHASE_AT_MS.blocked * INTRO_SCALE);

/** A phase start of the card in real time. */
export function phaseAt(phase: keyof typeof PHASE_AT_MS): number {
  return Math.round(PHASE_AT_MS[phase] * INTRO_SCALE);
}

export type Phase = 'idle' | 'owner' | 'leaked' | 'fixing' | 'blocked';
export type Actor = 'owner' | 'user_b' | 'visitor';
export type ChipState = 'idle' | 'allowed' | 'reached' | 'blocked';

/**
 * The verdict of an attacker chip is shown once: it goes from "waiting" to
 * LEAKED ("reached") and stays so until the Re-test says BLOCKED. It never goes
 * back to "waiting" in between.
 */
export function chipState(actor: Actor, phase: Phase): ChipState {
  if (actor === 'owner') return phase === 'idle' ? 'idle' : 'allowed';
  if (phase === 'blocked') return 'blocked';
  if (phase === 'leaked' || phase === 'fixing') return 'reached';
  return 'idle';
}

export interface IntroContext {
  pathname: string;
  reducedMotion: boolean;
  /** the flag of this tab's session is set */
  seen: boolean;
  /** sessionStorage can be read and written */
  storageOk: boolean;
}

/**
 * The intro is shown only on the home page, only once per tab, never with
 * reduced motion, and never when the flag cannot be stored (it would repeat on
 * every load).
 */
export function shouldShowIntro(context: IntroContext): boolean {
  return (
    context.pathname === '/' &&
    !context.reducedMotion &&
    context.storageOk &&
    !context.seen
  );
}

/**
 * How long the intro still has to run, when the page's own code takes over
 * `elapsedMs` after the head script started it (the scene has been running by
 * CSS since the first paint, so the end is counted from there, not from the
 * moment the page's code is ready).
 */
export function remainingMs(elapsedMs: number): number {
  return Math.max(0, INTRO_END_MS - Math.max(0, elapsedMs));
}

/**
 * The same rule, as the inline script of the <head>. It sets
 * `data-intro="pending"` on <html> (the CSS shows the overlay, locks the scroll
 * and holds the headline), writes the flag at once (a refresh during the intro
 * does not repeat it), remembers when it started (`window.__vcaIntroAt`) and
 * arms a timer that sets `data-intro="done"` if the page's own code never ends
 * the intro. The timer id is kept in `window.__vcaIntroTimer` so that the page's
 * code can replace it by one that starts when it takes over.
 */
export const INTRO_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(location.pathname!=='/')return;if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;var s=window.sessionStorage;if(s.getItem('${INTRO_KEY}'))return;s.setItem('${INTRO_KEY}','1');d.setAttribute('data-intro','pending');window.__vcaIntroAt=window.performance?window.performance.now():0;window.__vcaIntroTimer=setTimeout(function(){d.setAttribute('data-intro','done');},${INTRO_FALLBACK_MS});}catch(e){}})();`;
