// The opening of the home page (R70): the example run fills the screen once per
// tab, then the page shows its headline. The rules of "when" are here, in plain
// functions, so they can be tested. The boot script at the bottom is the same
// rule written as text: it runs in the <head> before the first paint (like the
// theme script), so the page never shows before the intro.

/** sessionStorage key: set when the intro starts, so a refresh in the same tab skips it. */
export const INTRO_KEY = 'vca-intro-v1';

/** The story as first written took 6.6 s. One number scales every delay of it (CSS and timers). */
export const INTRO_SCALE = 0.53;

/** When each phase of the example run starts, in the unscaled time of the first version (ms). */
export const PHASE_AT_MS = {
  owner: 2300,
  leaked: 3450,
  fixing: 4900,
  blocked: 6600,
} as const;

/** The whole story in real time: about 3.5 s. */
export const INTRO_STORY_MS = Math.round(PHASE_AT_MS.blocked * INTRO_SCALE);
/** The last frame (BLOCKED) stays this long before the overlay fades. */
export const INTRO_HOLD_MS = 500;
/** The fade of the overlay. */
export const INTRO_FADE_MS = 350;
/** If nothing has ended the intro by then, it is removed anyway: the story plus 1.5 s. */
export const INTRO_FALLBACK_MS = INTRO_STORY_MS + 1500;

/** A phase start in real time. */
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
 * The same rule, as the inline script of the <head>. It sets
 * `data-intro="pending"` on <html> (the CSS shows the overlay and holds the
 * headline), writes the flag at once (a refresh during the intro does not
 * repeat it) and arms a timer that sets `data-intro="done"` if the page's own
 * code never ends the intro. The timer id is kept in `window.__vcaIntroTimer`
 * so that the page's code can replace it by one that starts when it takes over.
 */
export const INTRO_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(location.pathname!=='/')return;if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;var s=window.sessionStorage;if(s.getItem('${INTRO_KEY}'))return;s.setItem('${INTRO_KEY}','1');d.setAttribute('data-intro','pending');window.__vcaIntroTimer=setTimeout(function(){d.setAttribute('data-intro','done');},${INTRO_FALLBACK_MS});}catch(e){}})();`;
