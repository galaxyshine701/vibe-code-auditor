// The opening of the home page (R70): a short scene fills the screen once per
// tab (a scan beam passes over a website and a database, a gate opens, the name
// appears), then the page shows its headline. The rules of "when" are here, in
// plain functions, so they can be tested. The boot script at the bottom is the
// same rule written as text: it runs in the <head> before the first paint (like
// the theme script), so the page never shows before the intro.
//
// When it is shown: only on the home page, only once per tab (the flag is in
// sessionStorage and is written at once, so a refresh does not repeat it), and
// only when the flag can be stored (otherwise it would repeat on every load).
// With reduced motion there is no intro at all.
// How it ends: the end of the scene; a tap, a click, Esc or the Skip button; the
// time limit of the page's code; the timer of the head script (3 s); and a CSS
// animation that hides the overlay after 3 s with no script.

/** sessionStorage key: set when the intro starts, so a refresh in the same tab skips it. */
export const INTRO_KEY = 'vca-intro-v1';

export type IntroMode = 'full';

// ---- The scene (full mode). The CSS has the same numbers as custom properties (--t-*). ----

/** When each part of the scene starts, in ms. The CSS (intro.css) uses the same times. */
export const INTRO_SCENE_MS = {
  /** the grid, the two objects draw on, the rings turn: 0 to 0.8 s */
  draw: 0,
  /** the beam sweeps, the callouts and the counter appear as it passes: 0.8 to 2.3 s */
  beam: 700,
  /** the rings contract into the gate line: 2.3 s */
  contract: 2000,
  /** the name appears, word by word */
  word: 2100,
  /** the gate splits open from the centre and the page shows */
  open: 2500,
} as const;

/** The name is fully shown and the gate starts to open at this time. */
export const INTRO_STORY_MS = INTRO_SCENE_MS.open;
/** The gate opens for this long. */
export const INTRO_HOLD_MS = 450;
/** The fade of the overlay (nothing is left to see by then). */
export const INTRO_FADE_MS = 350;
/** The scene ends here: under 3 s. */
export const INTRO_END_MS = INTRO_STORY_MS + INTRO_HOLD_MS;
/** The whole intro, fade included. */
export const INTRO_TOTAL_MS = INTRO_END_MS + INTRO_FADE_MS;
/** If nothing has ended the intro by then, it is removed anyway (the head script and the CSS use it too). */
export const INTRO_FALLBACK_MS = 3000;
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
 * Which intro to show, or null for none. Only on the home page, only once per
 * tab, never when the flag cannot be stored (it would repeat on every load),
 * and never with reduced motion.
 */
export function introModeOf(context: IntroContext): IntroMode | null {
  if (
    context.pathname !== '/' ||
    context.reducedMotion ||
    context.seen ||
    !context.storageOk
  ) {
    return null;
  }
  return 'full';
}

export function shouldShowIntro(context: IntroContext): boolean {
  return introModeOf(context) !== null;
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
 * `data-intro="pending"` on <html> (the CSS shows the overlay and locks the
 * scroll). With reduced motion it does nothing. It writes the flag at once (a refresh during the intro
 * does not repeat it), remembers when it started (`window.__vcaIntroAt`) and
 * arms a timer that sets `data-intro="done"` if the page's own code never ends
 * the intro. The timer id is kept in `window.__vcaIntroTimer` so that the page's
 * code can replace it by one that starts when it takes over.
 *
 * It also lets a click, a tap or Esc skip the scene BEFORE the page's code is
 * ready (a fade, then done); once the page's code has taken over
 * (`window.__vcaIntroOwned`), its own handlers do it.
 */
export const INTRO_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(location.pathname!=='/'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;var s=window.sessionStorage;if(s.getItem('${INTRO_KEY}'))return;s.setItem('${INTRO_KEY}','1');d.setAttribute('data-intro','pending');window.__vcaIntroAt=window.performance?window.performance.now():0;window.__vcaIntroTimer=setTimeout(function(){d.setAttribute('data-intro','done');},${INTRO_FALLBACK_MS});var skip=function(e){if(window.__vcaIntroOwned||d.getAttribute('data-intro')!=='pending')return;if(e.type==='keydown'&&e.key!=='Escape')return;document.removeEventListener('click',skip,true);document.removeEventListener('keydown',skip,true);d.setAttribute('data-intro','leaving');clearTimeout(window.__vcaIntroTimer);window.__vcaIntroTimer=setTimeout(function(){d.setAttribute('data-intro','done');},${INTRO_FADE_MS});};document.addEventListener('click',skip,true);document.addEventListener('keydown',skip,true);}catch(e){}})();`;
